import {
  MARKET_VERIFICATION_COMMAND_PREFIX,
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
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import { scheduleDetachedMarketMediaCleanup } from "./media-storage";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

const FUNCTION_ID = "market-verification";
const CLAIM_LEASE_MS = 5 * 60_000;
const FUNCTION_RETRIES = 3;
const RETRY_AFTER_HONOURED_ATTEMPTS = 2;
const RETRY_AFTER_CAP_MS = 60_000;

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

export function createMarketVerificationFunctions(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
) {
  const effect = client.createFunction(
    {
      id: FUNCTION_ID,
      retries: FUNCTION_RETRIES,
      timeouts: { finish: "8m" },
      triggers: [durableEvents.operationMarketVerificationRequested],
      onFailure: async ({ event, step }) => {
        const payload = event.data.event.data;
        await step.run("settle-failed-market-verification", () =>
          settleOwnedMarketVerification(
            runtime.db,
            payload.workspaceId,
            payload.operationId,
            claimant(payload.operationId),
            "failed",
          ),
        );
        await notifyMarketAnalysisChanged(
          step,
          payload.workspaceId,
          payload.marketAnalysisId,
          "failure",
        );
      },
    },
    async ({ attempt, event, maxAttempts, step }) => {
      const owner = claimant(event.data.operationId);
      const claimed = await step.run("claim-market-verification", async () => {
        await assertWorkspace(runtime, event.data.workspaceId);
        return claimOperationExecution(runtime.db, event.data.workspaceId, {
          id: event.data.operationId,
          claimedBy: owner,
          now: new Date(),
          leaseExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
        });
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
      if (
        !claimed.operation.commandType.startsWith(
          MARKET_VERIFICATION_COMMAND_PREFIX,
        )
      ) {
        throw new NonRetriableError(
          "market verification command type mismatch",
        );
      }
      const analysis = await step.run(
        "load-market-verification-request",
        async () => {
          const current = await getMarketAnalysis(
            runtime.db,
            event.data.workspaceId,
            event.data.marketAnalysisId,
          );
          if (
            !current?.verificationIntentId ||
            current.verificationIntentVersion < 1
          ) {
            throw new NonRetriableError(
              "market verification intent is missing",
            );
          }
          return current;
        },
      );
      const adapters = createMarketAdapters(
        resolveMarketProviderBindings(runtime.template, workerEnv),
      ).adapters;
      const outcomes = await Promise.all(
        analysis.normalizedRequest.series.map((series, index) =>
          step.run(`fetch-market-series-${index + 1}`, async () =>
            settleFetchAttempt(
              await fetchMarketSeries(
                adapters,
                series,
                analysis.normalizedRequest.period,
                new Date(),
              ),
              attempt,
              maxAttempts,
            ),
          ),
        ),
      );
      const hydratedOutcomes: MarketSeriesOutcome[] = outcomes.map((outcome) =>
        outcome.outcome === "succeeded"
          ? {
              ...outcome,
              coverageEnd: new Date(outcome.coverageEnd),
              coverageStart: new Date(outcome.coverageStart),
            }
          : outcome,
      );
      const verificationIntentId = analysis.verificationIntentId;
      if (!verificationIntentId) {
        throw new NonRetriableError("market verification intent is missing");
      }
      const settled = await step.run("persist-market-snapshot-and-settle", () =>
        persistMarketVerification(runtime.db, {
          workspaceId: event.data.workspaceId,
          operationId: event.data.operationId,
          marketAnalysisId: event.data.marketAnalysisId,
          claimedBy: owner,
          operationVersion: claimed.operation.version,
          request: analysis.normalizedRequest,
          requestFingerprint: analysis.requestFingerprint,
          templateFingerprint: analysis.templateFingerprint,
          verificationIntentId,
          verificationIntentVersion: analysis.verificationIntentVersion,
          outcomes: hydratedOutcomes,
        }),
      );
      if (settled.detachedMediaAssetIds.length > 0) {
        await step.run("schedule-detached-market-media-cleanup", () =>
          scheduleDetachedMarketMediaCleanup(
            runtime.db,
            event.data.workspaceId,
            settled.detachedMediaAssetIds,
          ),
        );
      }
      await notifyMarketAnalysisChanged(
        step,
        event.data.workspaceId,
        event.data.marketAnalysisId,
        settled.status,
      );
      return settled;
    },
  );
  const cancelled = client.createFunction(
    {
      id: `${FUNCTION_ID}-cancelled`,
      retries: 3,
      triggers: [
        {
          event: "inngest/function.cancelled",
          expression: `event.data.function_id == '${FUNCTION_ID}'`,
        },
      ],
    },
    async ({ event, step }) => {
      const envelope = event.data.event as
        | {
            data?: {
              operationId?: string;
              workspaceId?: string;
              marketAnalysisId?: string;
            };
          }
        | undefined;
      const payload = envelope?.data;
      if (
        !payload?.operationId ||
        !payload.workspaceId ||
        !payload.marketAnalysisId
      )
        return { status: "ignored" };
      const { marketAnalysisId, operationId, workspaceId } = payload;
      await step.run("settle-cancelled-market-verification", () =>
        settleOwnedMarketVerification(
          runtime.db,
          workspaceId,
          operationId,
          claimant(operationId),
          "cancelled",
        ),
      );
      await notifyMarketAnalysisChanged(
        step,
        workspaceId,
        marketAnalysisId,
        "cancelled",
      );
      return { status: "cancelled" };
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
  const settled: { marketAnalysisId: string; operationId: string }[] = [];
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
        marketAnalysisId: analysis.id,
        operationId: candidate.id,
      });
  }
  return settled;
}
