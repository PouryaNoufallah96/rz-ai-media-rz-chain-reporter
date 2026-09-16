import {
  MARKET_VERIFICATION_COMMAND_PREFIX,
  marketVerificationRequestedPayloadSchema,
  type NormalizedMarketRequest,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import { getMarketAnalysis } from "@rz-chain-reporter/db/repositories/market-analysis";
import { insertOrReloadMarketSnapshot } from "@rz-chain-reporter/db/repositories/market-snapshot";
import {
  claimOperationExecution,
  settleClaimedOperation,
} from "@rz-chain-reporter/db/repositories/operation";
import {
  marketAnalysis,
  marketGeneration,
} from "@rz-chain-reporter/db/schema/market-analysis";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { and, eq, gt, like, lte, sql } from "drizzle-orm";
import { NonRetriableError, RetryAfterError } from "inngest";
import { z } from "zod";
import { workerLogger } from "../logging/logger";
import { resolveMarketProviderBindings } from "../market/bindings";
import { createMarketAdapters, fetchMarketSeries } from "../market/fetcher";
import {
  classifyMarketSnapshot,
  ownsVerificationIntent,
} from "../market/outcome";
import { MarketProviderError, type MarketSeriesOutcome } from "../market/types";
import { alignToCommonWindow } from "../market/window";
import { workerEnv } from "../runtime/env";
import { notifyMarketAnalysisChanged } from "../web-cache/market-analysis";
import { publishOperationStatus } from "./channels";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import { scheduleDetachedMarketMediaCleanup } from "./media-storage";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

const FUNCTION_ID = "market-verification";
const CLAIM_LEASE_MS = 5 * 60_000;
const FUNCTION_RETRIES = 3;
const RETRY_AFTER_HONOURED_ATTEMPTS = 2;
const RETRY_AFTER_CAP_MS = 60_000;

const cancelledIdsSchema = z.object({
  data: z.object({ function_id: z.string(), run_id: z.string() }),
});

const cancelledEnvelopeSchema = z.object({
  data: z.object({
    event: z.object({ data: marketVerificationRequestedPayloadSchema }),
    run_id: z.string(),
  }),
});

function claimant(operationId: string) {
  return `${MARKET_VERIFICATION_COMMAND_PREFIX}${operationId}`;
}

export function settleFetchAttempt(
  outcome: MarketSeriesOutcome,
  attempt: number,
  maxAttempts: number = FUNCTION_RETRIES + 1,
): MarketSeriesOutcome {
  if (
    outcome.outcome === "succeeded" ||
    outcome.retryClassification === "permanent" ||
    attempt >= maxAttempts - 1
  ) {
    return outcome;
  }
  const retryAfterSeconds = outcome.retryAfterSeconds ?? null;
  if (retryAfterSeconds !== null && attempt < RETRY_AFTER_HONOURED_ATTEMPTS) {
    throw new RetryAfterError(
      `${outcome.failureCode} (${outcome.warnings.join(", ")})`,
      Math.min(retryAfterSeconds * 1_000, RETRY_AFTER_CAP_MS),
    );
  }
  throw new MarketProviderError(
    outcome.failureCode,
    outcome.retryClassification,
    {
      detail: outcome.warnings,
    },
  );
}

export async function loadMarketVerificationRequest(
  executor: Executor,
  workspaceId: string,
  marketAnalysisId: string,
  operationId: string,
) {
  const current = await getMarketAnalysis(
    executor,
    workspaceId,
    marketAnalysisId,
  );
  if (!current?.verificationIntentId || current.verificationIntentVersion < 1) {
    throw new NonRetriableError("market verification intent is missing");
  }
  if (current.verificationIntentId !== operationId) {
    return { status: "superseded" as const };
  }
  return { status: "current" as const, analysis: current };
}

async function verifyMarketAnalysis(
  runtime: WorkerRuntime,
  input: {
    attempt: number;
    eventTimestamp: number;
    marketAnalysisId: string;
    maxAttempts: number;
    operationId: string;
    operationVersion: number;
    workspaceId: string;
  },
) {
  const claimedBy = claimant(input.operationId);
  const loaded = await loadMarketVerificationRequest(
    runtime.db,
    input.workspaceId,
    input.marketAnalysisId,
    input.operationId,
  );
  if (loaded.status === "superseded") {
    const settled = await settleOwnedMarketVerification(
      runtime.db,
      input.workspaceId,
      input.operationId,
      claimedBy,
      "cancelled",
    );
    return {
      detachedMediaAssetIds: [] as string[],
      replay: false,
      settled: settled !== null,
      snapshotId: null,
      status: "superseded" as const,
    };
  }
  const analysis = loaded.analysis;
  const adapters = createMarketAdapters(
    resolveMarketProviderBindings(runtime.template, workerEnv),
  ).adapters;
  const outcomes = await Promise.all(
    analysis.normalizedRequest.series.map(async (series) =>
      settleFetchAttempt(
        await fetchMarketSeries(
          adapters,
          series,
          analysis.normalizedRequest.period,
          new Date(input.eventTimestamp),
        ),
        input.attempt,
        input.maxAttempts,
      ),
    ),
  );
  const persisted = await persistMarketVerification(runtime.db, {
    workspaceId: input.workspaceId,
    operationId: input.operationId,
    marketAnalysisId: input.marketAnalysisId,
    claimedBy,
    operationVersion: input.operationVersion,
    request: analysis.normalizedRequest,
    requestFingerprint: analysis.requestFingerprint,
    templateFingerprint: analysis.templateFingerprint,
    verificationIntentId: input.operationId,
    verificationIntentVersion: analysis.verificationIntentVersion,
    outcomes,
  });
  return { ...persisted, settled: true };
}

export function createMarketVerificationFunctions(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
  executeVerification = verifyMarketAnalysis,
) {
  const effect = client.createFunction(
    {
      id: FUNCTION_ID,
      retries: FUNCTION_RETRIES,
      timeouts: { finish: "8m" },
      triggers: [durableEvents.operationMarketVerificationRequested],
      onFailure: async ({ event, step }) => {
        const payload = event.data.event.data;
        const result = await step.run(
          "settle-failed-market-verification",
          async () => {
            const settled = await settleOwnedMarketVerification(
              runtime.db,
              payload.workspaceId,
              payload.operationId,
              claimant(payload.operationId),
              "failed",
            );
            return settled
              ? {
                  settled: true as const,
                  actor: settled.actor,
                  operationVersion: settled.version,
                }
              : { settled: false as const };
          },
        );
        if (result.settled) {
          await notifyMarketAnalysisChanged(
            step,
            payload.workspaceId,
            payload.marketAnalysisId,
            "failure",
          );
          await publishOperationStatus(
            step,
            payload.workspaceId,
            {
              actorId: result.actor,
              lifecycle: "failed",
              operationId: payload.operationId,
              operationVersion: result.operationVersion,
              sharedImport: false,
            },
            "worker.market-verification.realtime-unavailable",
          );
        }
      },
    },
    async ({ attempt, event, maxAttempts, step }) => {
      const owner = claimant(event.data.operationId);
      const claimed = await step.run("claim-market-verification", async () => {
        await assertWorkspace(runtime, event.data.workspaceId);
        const result = await claimOperationExecution(
          runtime.db,
          event.data.workspaceId,
          {
            id: event.data.operationId,
            claimedBy: owner,
            now: new Date(),
            leaseExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
          },
        );
        if (result.status !== "claimed") return { status: result.status };
        if (
          !result.operation.commandType.startsWith(
            MARKET_VERIFICATION_COMMAND_PREFIX,
          )
        ) {
          throw new NonRetriableError(
            "market verification command type mismatch",
          );
        }
        return {
          status: "claimed" as const,
          actor: result.operation.actor,
          operationVersion: result.operation.version,
        };
      });
      if (claimed.status !== "claimed") {
        if (claimed.status === "terminal") {
          await notifyMarketAnalysisChanged(
            step,
            event.data.workspaceId,
            event.data.marketAnalysisId,
            "replayed",
          );
        }
        return { status: claimed.status };
      }
      await publishOperationStatus(
        step,
        event.data.workspaceId,
        {
          actorId: claimed.actor,
          lifecycle: "running",
          operationId: event.data.operationId,
          operationVersion: claimed.operationVersion,
          sharedImport: false,
        },
        "worker.market-verification.realtime-unavailable",
      );
      const eventTimestamp = event.ts;
      if (eventTimestamp === undefined) {
        throw new NonRetriableError(
          "market verification event timestamp missing",
        );
      }
      const verified = await step.run("verify-market-series-and-settle", () =>
        executeVerification(runtime, {
          attempt,
          eventTimestamp,
          marketAnalysisId: event.data.marketAnalysisId,
          maxAttempts: maxAttempts ?? FUNCTION_RETRIES + 1,
          operationId: event.data.operationId,
          operationVersion: claimed.operationVersion,
          workspaceId: event.data.workspaceId,
        }),
      );
      if (verified.status === "superseded") {
        if (verified.settled) {
          await notifyMarketAnalysisChanged(
            step,
            event.data.workspaceId,
            event.data.marketAnalysisId,
            "superseded",
          );
          await publishOperationStatus(
            step,
            event.data.workspaceId,
            {
              actorId: claimed.actor,
              lifecycle: "cancelled",
              operationId: event.data.operationId,
              operationVersion: claimed.operationVersion + 1,
              sharedImport: false,
            },
            "worker.market-verification.realtime-unavailable",
          );
        }
        return { status: verified.status };
      }
      if (verified.detachedMediaAssetIds.length > 0) {
        await step.run("schedule-detached-market-media-cleanup", () =>
          scheduleDetachedMarketMediaCleanup(
            runtime.db,
            event.data.workspaceId,
            verified.detachedMediaAssetIds,
          ),
        );
      }
      await notifyMarketAnalysisChanged(
        step,
        event.data.workspaceId,
        event.data.marketAnalysisId,
        verified.status,
      );
      await publishOperationStatus(
        step,
        event.data.workspaceId,
        {
          actorId: claimed.actor,
          lifecycle: verified.status === "unverified" ? "failed" : "succeeded",
          operationId: event.data.operationId,
          operationVersion: claimed.operationVersion + 1,
          sharedImport: false,
        },
        "worker.market-verification.realtime-unavailable",
      );
      return verified;
    },
  );
  const cancelled = client.createFunction(
    {
      id: `${FUNCTION_ID}-cancelled`,
      retries: 3,
      triggers: [
        {
          event: "inngest/function.cancelled",
          if: `event.data.function_id == '${client.id}-${FUNCTION_ID}'`,
        },
      ],
    },
    async ({ event, step }) => {
      const envelope = cancelledEnvelopeSchema.safeParse(event);
      if (!envelope.success) {
        const ids = cancelledIdsSchema.safeParse(event);
        await step.run("report-cancelled-market-verification-invalid", () => {
          workerLogger.error(
            "worker.market-verification.cancelled-event-invalid",
            {
              errorCode: "VALIDATION_FAILED",
              functionId: ids.success ? ids.data.data.function_id : undefined,
              runId: ids.success ? ids.data.data.run_id : undefined,
            },
          );
          return { parsed: false };
        });
        return { status: "invalid" };
      }
      const payload = envelope.data.data.event.data;
      const { marketAnalysisId, operationId, workspaceId } = payload;
      const result = await step.run(
        "settle-cancelled-market-verification",
        async () => {
          const settled = await settleOwnedMarketVerification(
            runtime.db,
            workspaceId,
            operationId,
            claimant(operationId),
            "cancelled",
          );
          return settled
            ? {
                settled: true as const,
                actor: settled.actor,
                operationVersion: settled.version,
              }
            : { settled: false as const };
        },
      );
      if (result.settled) {
        await notifyMarketAnalysisChanged(
          step,
          workspaceId,
          marketAnalysisId,
          "cancelled",
        );
        await publishOperationStatus(
          step,
          workspaceId,
          {
            actorId: result.actor,
            lifecycle: "cancelled",
            operationId,
            operationVersion: result.operationVersion,
            sharedImport: false,
          },
          "worker.market-verification.realtime-unavailable",
        );
      }
      return { status: result.settled ? "cancelled" : "ignored" };
    },
  );
  return [effect, cancelled];
}

export async function settleOwnedMarketVerification(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  claimedBy: string,
  lifecycle: "cancelled" | "failed",
) {
  const [current] = await executor
    .select()
    .from(operation)
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        eq(operation.id, operationId),
      ),
    );
  if (!current || current.claimedBy !== claimedBy) return null;
  return settleClaimedOperation(executor, workspaceId, {
    id: operationId,
    claimedBy,
    expectedVersion: current.version,
    lifecycle,
  });
}

export async function persistMarketVerification(
  executor: Executor,
  input: {
    workspaceId: string;
    operationId: string;
    marketAnalysisId: string;
    claimedBy: string;
    operationVersion: number;
    request: NormalizedMarketRequest;
    requestFingerprint: string;
    templateFingerprint: string;
    verificationIntentId: string;
    verificationIntentVersion: number;
    outcomes: readonly MarketSeriesOutcome[];
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, input.workspaceId);
    const { outcomes: alignedOutcomes, window } = alignToCommonWindow(
      input.outcomes,
    );
    const status = classifyMarketSnapshot(
      input.request.series,
      alignedOutcomes,
    );
    const inserted = await insertOrReloadMarketSnapshot(tx, input.workspaceId, {
      snapshot: {
        marketAnalysisId: input.marketAnalysisId,
        operationId: input.operationId,
        verificationIntentId: input.verificationIntentId,
        verificationIntentVersion: input.verificationIntentVersion,
        normalizedRequest: input.request,
        requestFingerprint: input.requestFingerprint,
        templateFingerprint: input.templateFingerprint,
        period: input.request.period,
        scale: input.request.scale,
        effectiveWindowStart: window?.start ?? null,
        effectiveWindowEnd: window?.end ?? null,
        fetchCompletedAt: new Date(),
        status,
        warnings: alignedOutcomes.flatMap((outcome) => outcome.warnings),
      },
      series: input.request.series.map((series, index) => {
        const outcome = alignedOutcomes[index];
        if (!outcome) throw new Error("market series outcome missing");
        return outcome.outcome === "succeeded"
          ? {
              position: index + 1,
              descriptorIdentity: series.descriptorIdentity,
              role: series.role,
              controlledInstrumentId: series.controlledInstrumentId,
              provider: outcome.provider,
              mapping: outcome.mapping,
              providerReference: outcome.providerReference,
              attributionIdentity: outcome.attributionIdentity,
              points: outcome.points,
              coverageStart: outcome.coverageStart,
              coverageEnd: outcome.coverageEnd,
              startPrice: outcome.startPrice,
              endPrice: outcome.endPrice,
              changePercent: outcome.changePercent,
              outcome: "succeeded" as const,
              attemptedMappings: outcome.attemptedMappings,
              warnings: outcome.warnings,
            }
          : {
              position: index + 1,
              descriptorIdentity: series.descriptorIdentity,
              role: series.role,
              controlledInstrumentId: series.controlledInstrumentId,
              outcome: "failed" as const,
              failureCode: outcome.failureCode,
              attemptedMappings: outcome.attemptedMappings,
              retryClassification: outcome.retryClassification,
              warnings: outcome.warnings,
            };
      }),
    });
    const [current] = await tx
      .select()
      .from(marketAnalysis)
      .where(
        and(
          eq(marketAnalysis.workspaceId, input.workspaceId),
          eq(marketAnalysis.id, input.marketAnalysisId),
        ),
      )
      .for("update");
    if (!current) throw new NonRetriableError("market analysis disappeared");
    const owns =
      current.status === "in_progress" &&
      current.requestFingerprint === input.requestFingerprint &&
      ownsVerificationIntent(current, input);
    const [generation] = current.currentGenerationId
      ? await tx
          .select({
            chartMediaAssetId: marketGeneration.chartMediaAssetId,
            finalMediaAssetId: marketGeneration.finalMediaAssetId,
            providerOriginalMediaAssetId:
              marketGeneration.providerOriginalMediaAssetId,
          })
          .from(marketGeneration)
          .where(
            and(
              eq(marketGeneration.workspaceId, input.workspaceId),
              eq(marketGeneration.id, current.currentGenerationId),
            ),
          )
      : [];
    const replacesCurrentChain = owns && status !== "unverified";
    const detachedMediaAssetIds = replacesCurrentChain
      ? [
          current.currentChartMediaAssetId,
          current.currentFinalMediaAssetId,
          generation?.chartMediaAssetId,
          generation?.finalMediaAssetId,
          generation?.providerOriginalMediaAssetId,
        ].filter((id): id is string => id !== null && id !== undefined)
      : [];
    if (replacesCurrentChain) {
      const [updated] = await tx
        .update(marketAnalysis)
        .set({
          chartApprovalFingerprint: null,
          chartApprovedAt: null,
          chartApprovedBy: null,
          currentChartMediaAssetId: null,
          currentChartRenderId: null,
          currentFinalMediaAssetId: null,
          currentGenerationId: null,
          currentSnapshotId: inserted.snapshot.id,
          designApprovalFingerprint: null,
          designApprovedAt: null,
          designApprovedBy: null,
          designFamilyKey: null,
          designVariantKey: null,
          finalApprovalFingerprint: null,
          finalApprovedAt: null,
          finalApprovedBy: null,
          imageOptionKey: null,
          operatorDirection: null,
          storyApprovalFingerprint: null,
          storyApprovedAt: null,
          storyApprovedBy: null,
          storyHeadline: null,
          storySupportingText: null,
          updatedAt: new Date(),
          version: sql`${marketAnalysis.version} + 1`,
        })
        .where(
          and(
            eq(marketAnalysis.workspaceId, input.workspaceId),
            eq(marketAnalysis.id, input.marketAnalysisId),
            eq(marketAnalysis.verificationIntentId, input.verificationIntentId),
            eq(
              marketAnalysis.verificationIntentVersion,
              input.verificationIntentVersion,
            ),
          ),
        )
        .returning();
      if (!updated) {
        throw new Error("market verification lost aggregate ownership");
      }
    }
    const lifecycle = owns
      ? status === "unverified"
        ? "failed"
        : "succeeded"
      : "cancelled";
    const [settled] = await tx
      .update(operation)
      .set({
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lifecycle,
        updatedAt: new Date(),
        version: input.operationVersion + 1,
      })
      .where(
        and(
          eq(operation.workspaceId, input.workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.claimedBy, input.claimedBy),
          eq(operation.version, input.operationVersion),
          eq(operation.lifecycle, "running"),
          gt(operation.leaseExpiresAt, new Date()),
        ),
      )
      .returning();
    if (!settled)
      throw new Error("market verification lost operation ownership");
    return {
      detachedMediaAssetIds:
        owns && status !== "unverified"
          ? [...new Set(detachedMediaAssetIds)]
          : [],
      snapshotId: inserted.snapshot.id,
      replay: inserted.status === "replayed",
      status: owns ? status : "superseded",
    };
  });
}

export async function reconcileStaleMarketVerifications(
  runtime: WorkerRuntime,
  workspaceId: string,
  now: Date,
) {
  const stale = await runtime.db
    .select()
    .from(operation)
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        eq(operation.lifecycle, "running"),
        like(operation.commandType, `${MARKET_VERIFICATION_COMMAND_PREFIX}%`),
        lte(operation.leaseExpiresAt, now),
      ),
    )
    .limit(10);
  const settled: {
    actorId: string;
    lifecycle: "failed";
    marketAnalysisId: string;
    operationId: string;
    operationVersion: number;
  }[] = [];
  for (const candidate of stale) {
    const [analysis] = await runtime.db
      .select({ id: marketAnalysis.id })
      .from(marketAnalysis)
      .where(
        and(
          eq(marketAnalysis.workspaceId, workspaceId),
          eq(marketAnalysis.verificationIntentId, candidate.id),
        ),
      );
    const [updated] = await runtime.db
      .update(operation)
      .set({
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lifecycle: "failed",
        updatedAt: now,
        version: candidate.version + 1,
      })
      .where(
        and(
          eq(operation.workspaceId, workspaceId),
          eq(operation.id, candidate.id),
          eq(operation.version, candidate.version),
          eq(operation.lifecycle, "running"),
        ),
      )
      .returning();
    if (updated && analysis)
      settled.push({
        actorId: updated.actor,
        lifecycle: "failed",
        marketAnalysisId: analysis.id,
        operationId: candidate.id,
        operationVersion: updated.version,
      });
  }
  return settled;
}
