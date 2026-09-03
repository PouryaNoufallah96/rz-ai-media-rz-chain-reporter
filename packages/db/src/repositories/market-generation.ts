import {
  DURABLE_EVENT_SCHEMA_VERSION,
  MARKET_GENERATION_COMMAND_PREFIX,
  MARKET_GENERATION_FINAL_MEDIA_KIND,
  OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import { and, eq, inArray, isNull, like, lte, sql } from "drizzle-orm";

import type { Executor, Transaction } from "../executor";
import { withWorkspaceContext } from "../executor";
import { inWorkspace } from "../filters";
import { aiUsageEvent } from "../schema/ai-usage-event";
import {
  marketAnalysis,
  marketGeneration,
  marketInstrument,
} from "../schema/market-analysis";
import { mediaAsset } from "../schema/media-asset";
import { mediaDerivation } from "../schema/media-derivation";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";
import { outboxEvent } from "../schema/outbox-event";

export const MARKET_GENERATION_COMMAND = `${MARKET_GENERATION_COMMAND_PREFIX}analysis`;

type GenerationRow = typeof marketGeneration.$inferSelect;
type PreparedImageResult = {
  actualBytes: number;
  checksum: string;
  height: number;
  mediaAssetId: string;
  mimeType: string;
  objectKey: string;
  width: number;
};

export type MarketGenerationCommandResult = {
  analysis?: typeof marketAnalysis.$inferSelect;
  operationId?: string;
  status:
    | "completed"
    | "conflict"
    | "idempotency_mismatch"
    | "not_found"
    | "not_ready"
    | "replayed"
    | "updated";
};

export async function requestMarketGeneration(
  executor: Executor,
  workspaceId: string,
  userId: string,
  input: {
    actor: string;
    analysisId: string;
    chartMediaAssetId: string;
    chartMediaChecksum: string;
    expectedDesignFingerprint: string;
    expectedVersion: number;
    generationId: string;
    idempotencyKey: string;
    imageOptionKey: string;
    intentId: string;
    operationId: string;
    operatorDirection: string | null;
    outputHeight: number;
    outputWidth: number;
    referenceSampleChecksum: string;
    referenceSampleKey: string;
    requestHash: string;
    requestId: string | null;
  },
): Promise<MarketGenerationCommandResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [row] = await tx
      .select({ analysis: marketAnalysis })
      .from(marketAnalysis)
      .innerJoin(operation, eq(operation.id, marketAnalysis.operationId))
      .where(
        and(
          inWorkspace(marketAnalysis, workspaceId),
          eq(marketAnalysis.id, input.analysisId),
          eq(operation.actor, userId),
        ),
      )
      .for("update");
    if (!row) return { status: "not_found" };
    if (row.analysis.status === "completed") return { status: "completed" };
    const [prior] = await tx
      .select()
      .from(operation)
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.actor, userId),
          eq(operation.commandType, MARKET_GENERATION_COMMAND),
          eq(operation.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (prior) {
      return prior.requestHash === input.requestHash
        ? { status: "replayed", analysis: row.analysis, operationId: prior.id }
        : { status: "idempotency_mismatch" };
    }
    if (row.analysis.version !== input.expectedVersion)
      return { status: "conflict" };
    if (
      row.analysis.designApprovalFingerprint !==
        input.expectedDesignFingerprint ||
      row.analysis.currentChartMediaAssetId !== input.chartMediaAssetId
    ) {
      return { status: "not_ready" };
    }
    const [chart] = await tx
      .select({
        checksum: mediaAsset.checksum,
        lifecycle: mediaAsset.lifecycle,
      })
      .from(mediaAsset)
      .where(
        and(
          inWorkspace(mediaAsset, workspaceId),
          eq(mediaAsset.id, input.chartMediaAssetId),
        ),
      );
    if (
      chart?.lifecycle !== "verified" ||
      chart.checksum !== input.chartMediaChecksum
    ) {
      return { status: "not_ready" };
    }
    await tx.insert(operation).values({
      id: input.operationId,
      workspaceId,
      actor: input.actor,
      commandType: MARKET_GENERATION_COMMAND,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      requestId: input.requestId,
    });
    const [generation] = await tx
      .insert(marketGeneration)
      .values({
        id: input.generationId,
        workspaceId,
        operationId: input.operationId,
        marketAnalysisId: input.analysisId,
        intentId: input.intentId,
        intentVersion: row.analysis.version,
        expectedDesignFingerprint: input.expectedDesignFingerprint,
        imageOptionKey: input.imageOptionKey,
        operatorDirection: input.operatorDirection,
        referenceSampleKey: input.referenceSampleKey,
        referenceSampleChecksum: input.referenceSampleChecksum,
        chartMediaAssetId: input.chartMediaAssetId,
        chartMediaChecksum: input.chartMediaChecksum,
        outputWidth: input.outputWidth,
        outputHeight: input.outputHeight,
      })
      .returning();
    if (!generation) throw new Error("MARKET_GENERATION_INSERT_LOST");
    const [analysis] = await tx
      .update(marketAnalysis)
      .set({
        currentGenerationId: generation.id,
        imageOptionKey: input.imageOptionKey,
        operatorDirection: input.operatorDirection,
        currentFinalMediaAssetId: null,
        finalApprovalFingerprint: null,
        finalApprovedAt: null,
        finalApprovedBy: null,
        updatedAt: new Date(),
        version: row.analysis.version + 1,
      })
      .where(
        and(
          inWorkspace(marketAnalysis, workspaceId),
          eq(marketAnalysis.id, row.analysis.id),
          eq(marketAnalysis.version, row.analysis.version),
        ),
      )
      .returning();
    if (!analysis) throw new Error("MARKET_GENERATION_ANALYSIS_CAS_LOST");
    await insertWake(tx, workspaceId, generation);
    return { status: "updated", analysis, operationId: input.operationId };
  });
}

async function insertWake(
  tx: Transaction,
  workspaceId: string,
  generation: GenerationRow,
) {
  await tx.insert(outboxEvent).values({
    workspaceId,
    operationId: generation.operationId,
    eventType: OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME,
    schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
    payload: {
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      workspaceId,
      operationId: generation.operationId,
      marketAnalysisId: generation.marketAnalysisId,
      marketGenerationId: generation.id,
    },
  });
}

export async function loadMarketGenerationContext(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const [row] = await executor
    .select({
      analysis: marketAnalysis,
      generation: marketGeneration,
      instrumentKey: marketInstrument.key,
      operation,
    })
    .from(marketGeneration)
    .innerJoin(operation, eq(operation.id, marketGeneration.operationId))
    .innerJoin(
      marketAnalysis,
      eq(marketAnalysis.id, marketGeneration.marketAnalysisId),
    )
    .innerJoin(
      marketInstrument,
      eq(marketInstrument.id, marketAnalysis.visualOwnerInstrumentId),
    )
    .where(
      and(
        inWorkspace(marketGeneration, workspaceId),
        eq(marketGeneration.operationId, operationId),
      ),
    );
  return row ?? null;
}

export async function persistMarketBrief(
  tx: Transaction,
  workspaceId: string,
  input: {
    acceptedBrief: unknown;
    briefPolicyVersion: string;
    briefSchemaVersion: string;
    briefSource: "deterministic_fallback" | "model";
    fallbackCode?: string | null;
    generationId: string;
    policyRejections: readonly unknown[];
  },
) {
  await tx
    .update(marketGeneration)
    .set({
      acceptedBrief: input.acceptedBrief,
      briefPolicyVersion: input.briefPolicyVersion,
      briefSchemaVersion: input.briefSchemaVersion,
      briefSource: input.briefSource,
      fallbackCode: input.fallbackCode as never,
      policyRejections: [...input.policyRejections].slice(0, 12),
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(marketGeneration, workspaceId),
        eq(marketGeneration.id, input.generationId),
        isNull(marketGeneration.acceptedBrief),
      ),
    );
}

export async function persistMarketBriefRejection(
  tx: Transaction,
  workspaceId: string,
  input: { generationId: string; rejection: unknown },
) {
  await tx
    .update(marketGeneration)
    .set({
      policyRejections: sql`jsonb_path_query_array(coalesce(${marketGeneration.policyRejections}, '[]'::jsonb) || ${JSON.stringify([input.rejection])}::jsonb, '$[0 to 11]')`,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(marketGeneration, workspaceId),
        eq(marketGeneration.id, input.generationId),
        isNull(marketGeneration.acceptedBrief),
      ),
    );
}

export async function reserveMarketProviderOriginal(
  executor: Executor,
  workspaceId: string,
  input: { generationId: string; mediaAssetId: string; objectKey: string },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [generation] = await tx
      .select()
      .from(marketGeneration)
      .where(
        and(
          inWorkspace(marketGeneration, workspaceId),
          eq(marketGeneration.id, input.generationId),
        ),
      )
      .for("update");
    if (!generation || generation.providerOriginalMediaAssetId)
      return generation ?? null;
    await tx
      .insert(mediaAsset)
      .values({
        id: input.mediaAssetId,
        workspaceId,
        kind: "market_generation_provider_original",
        objectKey: input.objectKey,
        mimeType: "image/png",
        declaredBytes: 0,
      })
      .onConflictDoNothing();
    return generation;
  });
}

export async function rejectMarketProviderOriginal(
  executor: Executor,
  workspaceId: string,
  mediaAssetId: string,
) {
  const [rejected] = await executor
    .update(mediaAsset)
    .set({
      lifecycle: "rejected",
      rejectionReason: "provider_result_rejected",
      updatedAt: new Date(),
      version: sql`${mediaAsset.version} + 1`,
    })
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, mediaAssetId),
        eq(mediaAsset.lifecycle, "pending"),
      ),
    )
    .returning();
  return rejected ? ("rejected" as const) : ("uncertain" as const);
}

export async function resolveMarketProviderOriginal(
  executor: Executor,
  workspaceId: string,
  generationId: string,
  mediaAssetId: string,
) {
  const [row] = await executor
    .select({
      providerOriginalMediaAssetId:
        marketGeneration.providerOriginalMediaAssetId,
    })
    .from(marketGeneration)
    .where(
      and(
        inWorkspace(marketGeneration, workspaceId),
        eq(marketGeneration.id, generationId),
      ),
    );
  if (!row) return "uncertain" as const;
  return row.providerOriginalMediaAssetId === mediaAssetId
    ? ("committed" as const)
    : row.providerOriginalMediaAssetId
      ? ("uncertain" as const)
      : ("absent" as const);
}

export async function attachMarketProviderOriginal(
  tx: Transaction,
  workspaceId: string,
  input: {
    generationId: string;
    media: PreparedImageResult;
    promptDigest: string;
    promptPolicyVersion: string;
  },
) {
  const [asset] = await tx
    .update(mediaAsset)
    .set({
      actualBytes: input.media.actualBytes,
      checksum: input.media.checksum,
      height: input.media.height,
      lifecycle: "verified",
      mimeType: input.media.mimeType,
      verifiedAt: new Date(),
      width: input.media.width,
      updatedAt: new Date(),
      version: sql`${mediaAsset.version} + 1`,
    })
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, input.media.mediaAssetId),
      ),
    )
    .returning();
  if (!asset) throw new Error("MARKET_PROVIDER_ORIGINAL_RESERVATION_LOST");
  const [generation] = await tx
    .update(marketGeneration)
    .set({
      providerOriginalMediaAssetId: asset.id,
      promptDigest: input.promptDigest,
      promptPolicyVersion: input.promptPolicyVersion,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(marketGeneration, workspaceId),
        eq(marketGeneration.id, input.generationId),
        isNull(marketGeneration.providerOriginalMediaAssetId),
      ),
    )
    .returning();
  if (!generation) throw new Error("MARKET_PROVIDER_ORIGINAL_ATTACH_LOST");
}

export async function attachMarketFinal(
  executor: Executor,
  workspaceId: string,
  input: { final: PreparedImageResult; generationId: string },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [generation] = await tx
      .select()
      .from(marketGeneration)
      .where(
        and(
          inWorkspace(marketGeneration, workspaceId),
          eq(marketGeneration.id, input.generationId),
        ),
      )
      .for("update");
    if (!generation?.providerOriginalMediaAssetId) return null;
    if (generation.finalMediaAssetId) return generation;
    await tx
      .insert(mediaAsset)
      .values({
        id: input.final.mediaAssetId,
        workspaceId,
        kind: MARKET_GENERATION_FINAL_MEDIA_KIND,
        objectKey: input.final.objectKey,
        mimeType: input.final.mimeType,
        declaredBytes: input.final.actualBytes,
        actualBytes: input.final.actualBytes,
        checksum: input.final.checksum,
        width: input.final.width,
        height: input.final.height,
        lifecycle: "verified",
        verifiedAt: new Date(),
      })
      .onConflictDoNothing();
    await tx
      .insert(mediaDerivation)
      .values({
        workspaceId,
        sourceMediaAssetId: generation.providerOriginalMediaAssetId,
        derivedMediaAssetId: input.final.mediaAssetId,
        purpose: "market_analysis_footer_lockup",
      })
      .onConflictDoNothing();
    const [updated] = await tx
      .update(marketGeneration)
      .set({
        finalMediaAssetId: input.final.mediaAssetId,
        updatedAt: new Date(),
      })
      .where(
        and(
          inWorkspace(marketGeneration, workspaceId),
          eq(marketGeneration.id, generation.id),
          isNull(marketGeneration.finalMediaAssetId),
        ),
      )
      .returning();
    if (!updated) return null;
    const [analysis] = await tx
      .select()
      .from(marketAnalysis)
      .where(
        and(
          inWorkspace(marketAnalysis, workspaceId),
          eq(marketAnalysis.id, generation.marketAnalysisId),
        ),
      )
      .for("update");
    if (
      !analysis ||
      analysis.currentGenerationId !== generation.id ||
      analysis.designApprovalFingerprint !==
        generation.expectedDesignFingerprint ||
      analysis.operatorDirection !== generation.operatorDirection ||
      analysis.imageOptionKey !== generation.imageOptionKey
    ) {
      return { ...updated, superseded: true };
    }
    await tx
      .update(marketAnalysis)
      .set({
        currentFinalMediaAssetId: input.final.mediaAssetId,
        updatedAt: new Date(),
        version: analysis.version + 1,
      })
      .where(
        and(
          inWorkspace(marketAnalysis, workspaceId),
          eq(marketAnalysis.id, analysis.id),
          eq(marketAnalysis.version, analysis.version),
        ),
      );
    return { ...updated, superseded: false };
  });
}

export async function releaseMarketFinalizationForRetry(
  executor: Executor,
  workspaceId: string,
  input: { claimedBy: string; expectedVersion: number; operationId: string },
) {
  const [released] = await executor
    .update(operation)
    .set({
      lifecycle: "queued",
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, input.operationId),
        eq(operation.lifecycle, "running"),
        eq(operation.claimedBy, input.claimedBy),
        eq(operation.version, input.expectedVersion),
      ),
    )
    .returning();
  return released ?? null;
}

export async function retryMarketGenerationFinalization(
  executor: Executor,
  workspaceId: string,
  userId: string,
  input: { operationId: string; expectedEpoch: number; receipt: string },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [row] = await tx
      .select({ generation: marketGeneration, operation })
      .from(marketGeneration)
      .innerJoin(operation, eq(operation.id, marketGeneration.operationId))
      .where(
        and(
          inWorkspace(marketGeneration, workspaceId),
          eq(marketGeneration.operationId, input.operationId),
          eq(operation.actor, userId),
        ),
      )
      .for("update");
    if (!row) return { status: "not_found" as const };
    if (
      row.operation.lifecycle !== "queued" ||
      !row.generation.providerOriginalMediaAssetId ||
      row.generation.finalMediaAssetId ||
      row.generation.finalizationRetryEpoch !== input.expectedEpoch
    )
      return {
        status: "conflict" as const,
        epoch: row.generation.finalizationRetryEpoch,
      };
    const [updated] = await tx
      .update(marketGeneration)
      .set({
        finalizationRetryEpoch: input.expectedEpoch + 1,
        latestFinalizationRetryReceipt: input.receipt,
        updatedAt: new Date(),
      })
      .where(
        and(
          inWorkspace(marketGeneration, workspaceId),
          eq(marketGeneration.id, row.generation.id),
          eq(marketGeneration.finalizationRetryEpoch, input.expectedEpoch),
        ),
      )
      .returning();
    if (!updated)
      return {
        status: "conflict" as const,
        epoch: row.generation.finalizationRetryEpoch,
      };
    await insertWake(tx, workspaceId, updated);
    return {
      status: "updated" as const,
      epoch: updated.finalizationRetryEpoch,
    };
  });
}

export async function listMarketGenerationUsage(
  executor: Executor,
  workspaceId: string,
  operationAttemptId: string,
) {
  return executor
    .select({
      invocationKey: aiUsageEvent.invocationKey,
      status: aiUsageEvent.status,
    })
    .from(aiUsageEvent)
    .where(
      and(
        inWorkspace(aiUsageEvent, workspaceId),
        eq(aiUsageEvent.operationAttemptId, operationAttemptId),
      ),
    );
}

export async function readLatestMarketGenerationAttempt(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const [attempt] = await executor
    .select()
    .from(operationAttempt)
    .where(
      and(
        inWorkspace(operationAttempt, workspaceId),
        eq(operationAttempt.operationId, operationId),
        isNull(operationAttempt.outcome),
      ),
    )
    .orderBy(sql`${operationAttempt.attemptNumber} desc`)
    .limit(1);
  return attempt ?? null;
}

export async function reconcileStaleMarketGenerations(
  executor: Executor,
  workspaceId: string,
  now: Date,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const candidates = await tx
      .select({
        analysis: marketAnalysis,
        generation: marketGeneration,
        operation,
      })
      .from(marketGeneration)
      .innerJoin(operation, eq(operation.id, marketGeneration.operationId))
      .innerJoin(
        marketAnalysis,
        eq(marketAnalysis.id, marketGeneration.marketAnalysisId),
      )
      .where(
        and(
          inWorkspace(marketGeneration, workspaceId),
          eq(operation.lifecycle, "running"),
          like(operation.commandType, `${MARKET_GENERATION_COMMAND_PREFIX}%`),
          lte(operation.leaseExpiresAt, now),
        ),
      )
      .for("update", { skipLocked: true });
    const settled: Array<{
      lifecycle: "cancelled" | "failed" | "queued" | "succeeded" | "unknown";
      marketAnalysisId: string;
      operationId: string;
    }> = [];
    for (const candidate of candidates) {
      let lifecycle: (typeof settled)[number]["lifecycle"];
      if (candidate.generation.finalMediaAssetId) {
        lifecycle =
          candidate.analysis.currentGenerationId === candidate.generation.id &&
          candidate.analysis.currentFinalMediaAssetId ===
            candidate.generation.finalMediaAssetId
            ? "succeeded"
            : "cancelled";
      } else if (candidate.generation.providerOriginalMediaAssetId) {
        lifecycle = "queued";
      } else {
        const [ambiguous] = await tx
          .select({ id: aiUsageEvent.id })
          .from(aiUsageEvent)
          .where(
            and(
              inWorkspace(aiUsageEvent, workspaceId),
              eq(aiUsageEvent.operationId, candidate.operation.id),
              inArray(aiUsageEvent.status, ["pending", "unknown"]),
            ),
          )
          .limit(1);
        lifecycle = ambiguous ? "unknown" : "failed";
      }
      await tx
        .update(operation)
        .set({
          claimedAt: null,
          claimedBy: null,
          leaseExpiresAt: null,
          lifecycle,
          updatedAt: now,
          version: candidate.operation.version + 1,
        })
        .where(
          and(
            inWorkspace(operation, workspaceId),
            eq(operation.id, candidate.operation.id),
            eq(operation.version, candidate.operation.version),
          ),
        );
      settled.push({
        lifecycle,
        marketAnalysisId: candidate.generation.marketAnalysisId,
        operationId: candidate.operation.id,
      });
    }
    return settled;
  });
}
