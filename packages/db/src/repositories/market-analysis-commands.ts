import {
  type ContentLocale,
  DURABLE_EVENT_SCHEMA_VERSION,
  type NormalizedMarketRequest,
  OPERATION_MARKET_CHART_RENDER_REQUESTED_EVENT_NAME,
  OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import { and, eq, inArray } from "drizzle-orm";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import {
  marketAnalysis,
  marketChartDefault,
  marketChartRender,
  marketGeneration,
} from "../schema/market-analysis";
import { mediaAsset } from "../schema/media-asset";
import { operation } from "../schema/operation";
import { outboxEvent } from "../schema/outbox-event";
import { scheduleDetachedMediaCleanup } from "./media-asset";
import { readOperationIdentity } from "./operation";

export const MARKET_ANALYSIS_CREATE_COMMAND = "market-analysis:create";
export const MARKET_VERIFICATION_COMMAND = "market-verification:analysis";
export const MARKET_CHART_RENDER_COMMAND = "market-chart-render:analysis";

type AnalysisRow = typeof marketAnalysis.$inferSelect;
type ChartSpec = NonNullable<AnalysisRow["currentChartSpec"]>;
type DesignMaterial = {
  familyKey: string;
  variantKey: string;
};
type TransactionalExecutor = Pick<Executor, "transaction">;
type CommandStatus =
  | "completed"
  | "conflict"
  | "idempotency_mismatch"
  | "not_found"
  | "not_ready"
  | "replayed"
  | "updated";

type CommandResult = {
  status: CommandStatus;
  analysis?: AnalysisRow;
  operationId?: string;
};

type Identity = {
  operationId: string;
  actor: string;
  commandType: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string | null;
};

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(",")}}`;
}

function materialChartSpec(spec: ChartSpec) {
  return canonicalize(
    Object.fromEntries(
      Object.entries(spec).filter(([key]) => key !== "presetId"),
    ),
  );
}

async function insertCommandOperation(
  tx: Transaction,
  workspaceId: string,
  input: Identity & { lifecycle?: "queued" | "succeeded" },
) {
  const [created] = await tx
    .insert(operation)
    .values({
      id: input.operationId,
      workspaceId,
      actor: input.actor,
      commandType: input.commandType,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      requestId: input.requestId,
      lifecycle: input.lifecycle,
    })
    .onConflictDoNothing({
      target: [
        operation.workspaceId,
        operation.actor,
        operation.commandType,
        operation.idempotencyKey,
      ],
    })
    .returning();
  if (created) return { status: "created" as const, operation: created };

  const [existing] = await tx
    .select()
    .from(operation)
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.actor, input.actor),
        eq(operation.commandType, input.commandType),
        eq(operation.idempotencyKey, input.idempotencyKey),
      ),
    );
  if (!existing) throw new Error("market command identity conflict vanished");
  return existing.requestHash === input.requestHash
    ? { status: "replayed" as const, operation: existing }
    : { status: "mismatch" as const };
}

async function readOwnedAnalysisForUpdate(
  tx: Transaction,
  workspaceId: string,
  userId: string,
  analysisId: string,
) {
  const [row] = await tx
    .select({ analysis: marketAnalysis })
    .from(marketAnalysis)
    .innerJoin(operation, eq(operation.id, marketAnalysis.operationId))
    .where(
      and(
        inWorkspace(marketAnalysis, workspaceId),
        eq(marketAnalysis.id, analysisId),
        eq(operation.actor, userId),
      ),
    )
    .for("update");
  return row?.analysis ?? null;
}

function admissionStatus(row: AnalysisRow | null) {
  if (!row) return "not_found" as const;
  if (row.status === "completed") return "completed" as const;
  return null;
}

const clearFinal = {
  currentFinalMediaAssetId: null,
  finalApprovalFingerprint: null,
  finalApprovedAt: null,
  finalApprovedBy: null,
} as const;

const clearDesignAndFinal = {
  designFamilyKey: null,
  designVariantKey: null,
  operatorDirection: null,
  imageOptionKey: null,
  currentGenerationId: null,
  designApprovalFingerprint: null,
  designApprovedAt: null,
  designApprovedBy: null,
  ...clearFinal,
} as const;

const clearStoryAndDownstream = {
  storyHeadline: null,
  storySupportingText: null,
  storyApprovalFingerprint: null,
  storyApprovedAt: null,
  storyApprovedBy: null,
  ...clearDesignAndFinal,
} as const;

const clearChartAndDownstream = {
  currentChartRenderId: null,
  currentChartMediaAssetId: null,
  chartApprovalFingerprint: null,
  chartApprovedAt: null,
  chartApprovedBy: null,
  ...clearStoryAndDownstream,
} as const;

async function cleanupDetached(
  tx: Transaction,
  workspaceId: string,
  before: AnalysisRow,
  after: AnalysisRow,
) {
  const detached = new Set<string>();
  if (
    before.currentChartMediaAssetId &&
    before.currentChartMediaAssetId !== after.currentChartMediaAssetId
  ) {
    detached.add(before.currentChartMediaAssetId);
  }
  if (
    before.currentFinalMediaAssetId &&
    before.currentFinalMediaAssetId !== after.currentFinalMediaAssetId
  ) {
    detached.add(before.currentFinalMediaAssetId);
  }
  for (const mediaAssetId of detached) {
    await scheduleDetachedMediaCleanup(tx, workspaceId, mediaAssetId);
  }
}

async function casUpdate(
  tx: Transaction,
  workspaceId: string,
  row: AnalysisRow,
  changes: Partial<typeof marketAnalysis.$inferInsert>,
) {
  const [updated] = await tx
    .update(marketAnalysis)
    .set({
      ...changes,
      updatedAt: new Date(),
      version: row.version + 1,
    })
    .where(
      and(
        inWorkspace(marketAnalysis, workspaceId),
        eq(marketAnalysis.id, row.id),
        eq(marketAnalysis.status, "in_progress"),
        eq(marketAnalysis.version, row.version),
      ),
    )
    .returning();
  if (!updated) return null;
  await cleanupDetached(tx, workspaceId, row, updated);
  return updated;
}

export async function createOwnedMarketAnalysis(
  executor: Executor,
  workspaceId: string,
  userId: string,
  input: Identity & {
    analysisId: string;
    mediaBrandId: string;
    visualOwnerInstrumentId: string;
    contentLocale: ContentLocale;
    outputFormat: "portrait" | "square" | "story" | "landscape";
    normalizedRequest: NormalizedMarketRequest;
    requestFingerprint: string;
    currentChartSpec: ChartSpec;
    templateFingerprint: string;
    catalogFingerprint: string | null;
    instrumentProfileFingerprint: string;
    verification: Identity & { verificationIntentId: string };
  },
): Promise<CommandResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const identity = await insertCommandOperation(tx, workspaceId, {
      ...input,
      actor: userId,
      lifecycle: "succeeded",
    });
    if (identity.status === "mismatch") {
      return { status: "idempotency_mismatch" };
    }
    let analysis: AnalysisRow;
    if (identity.status === "replayed") {
      const [existing] = await tx
        .select()
        .from(marketAnalysis)
        .where(
          and(
            inWorkspace(marketAnalysis, workspaceId),
            eq(marketAnalysis.operationId, identity.operation.id),
          ),
        )
        .for("update");
      if (!existing) throw new Error("market analysis replay row is missing");
      analysis = existing;
    } else {
      const [created] = await tx
        .insert(marketAnalysis)
        .values({
          id: input.analysisId,
          workspaceId,
          operationId: identity.operation.id,
          mediaBrandId: input.mediaBrandId,
          visualOwnerInstrumentId: input.visualOwnerInstrumentId,
          contentLocale: input.contentLocale,
          outputFormat: input.outputFormat,
          normalizedRequest: input.normalizedRequest,
          requestFingerprint: input.requestFingerprint,
          currentChartSpec: input.currentChartSpec,
          templateFingerprint: input.templateFingerprint,
          catalogFingerprint: input.catalogFingerprint,
          instrumentProfileFingerprint: input.instrumentProfileFingerprint,
        })
        .returning();
      if (!created) throw new Error("market analysis insert returned no row");
      analysis = created;
    }
    return enqueueVerification(tx, workspaceId, userId, analysis, {
      ...input.verification,
      expectedVersion: analysis.version,
    });
  });
}

type MarketRequestChange = {
  normalizedRequest: NormalizedMarketRequest;
  requestFingerprint: string;
  outputFormat: "portrait" | "square" | "story" | "landscape";
  mediaBrandId: string;
  visualOwnerInstrumentId: string;
  visualOwnerChartSpec: ChartSpec;
  instrumentProfileFingerprint: string;
  contentLocale: ContentLocale;
};

export async function updateMarketAnalysisStage(
  executor: Executor,
  workspaceId: string,
  userId: string,
  input: {
    analysisId: string;
    expectedVersion: number;
    change: MarketRequestChange;
    verification: Identity & { verificationIntentId: string };
  },
): Promise<CommandResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const row = await readOwnedAnalysisForUpdate(
      tx,
      workspaceId,
      userId,
      input.analysisId,
    );
    const rejected = admissionStatus(row);
    if (rejected || !row) return { status: rejected ?? "not_found" };

    const change = input.change;
    let changes: Partial<typeof marketAnalysis.$inferInsert> | null = null;
    if (row.requestFingerprint !== change.requestFingerprint) {
      changes = {
        normalizedRequest: change.normalizedRequest,
        requestFingerprint: change.requestFingerprint,
        outputFormat: change.outputFormat,
        mediaBrandId: change.mediaBrandId,
        visualOwnerInstrumentId: change.visualOwnerInstrumentId,
        instrumentProfileFingerprint: change.instrumentProfileFingerprint,
        contentLocale: change.contentLocale,
        currentSnapshotId: null,
        currentChartSpec: change.visualOwnerChartSpec,
        verificationIntentId: null,
        ...clearChartAndDownstream,
      };
    } else if (
      row.visualOwnerInstrumentId !== change.visualOwnerInstrumentId ||
      row.instrumentProfileFingerprint !== change.instrumentProfileFingerprint
    ) {
      changes = {
        outputFormat: change.outputFormat,
        mediaBrandId: change.mediaBrandId,
        visualOwnerInstrumentId: change.visualOwnerInstrumentId,
        instrumentProfileFingerprint: change.instrumentProfileFingerprint,
        contentLocale: change.contentLocale,
        currentChartSpec: change.visualOwnerChartSpec,
        ...clearChartAndDownstream,
      };
    } else if (row.contentLocale !== change.contentLocale) {
      changes = {
        outputFormat: change.outputFormat,
        contentLocale: change.contentLocale,
        ...clearChartAndDownstream,
      };
    } else if (row.outputFormat !== change.outputFormat) {
      changes = {
        outputFormat: change.outputFormat,
        currentGenerationId: null,
        designApprovalFingerprint: null,
        designApprovedAt: null,
        designApprovedBy: null,
        ...clearFinal,
      };
    }

    if (!changes) {
      return enqueueVerification(tx, workspaceId, userId, row, {
        ...input.verification,
        expectedVersion: row.version,
      });
    }
    if (row.version !== input.expectedVersion) return { status: "conflict" };
    const updated = await casUpdate(tx, workspaceId, row, changes);
    if (!updated) return { status: "conflict" };
    return enqueueVerification(tx, workspaceId, userId, updated, {
      ...input.verification,
      expectedVersion: updated.version,
    });
  });
}

export async function requestMarketVerification(
  executor: TransactionalExecutor,
  workspaceId: string,
  userId: string,
  input: Identity & {
    analysisId: string;
    expectedVersion: number;
    verificationIntentId: string;
  },
): Promise<CommandResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const row = await readOwnedAnalysisForUpdate(
      tx,
      workspaceId,
      userId,
      input.analysisId,
    );
    if (!row) return { status: "not_found" };
    return enqueueVerification(tx, workspaceId, userId, row, input);
  });
}

async function enqueueVerification(
  tx: Transaction,
  workspaceId: string,
  userId: string,
  row: AnalysisRow,
  input: Identity & {
    expectedVersion: number;
    verificationIntentId: string;
  },
): Promise<CommandResult> {
  const replay = await readOperationIdentity(tx, workspaceId, {
    actor: userId,
    commandType: MARKET_VERIFICATION_COMMAND,
    idempotencyKey: input.idempotencyKey,
  });
  if (replay) {
    return replay.requestHash === input.requestHash
      ? {
          status: "replayed",
          analysis: row,
          operationId: replay.id,
        }
      : { status: "idempotency_mismatch" };
  }
  const rejected = admissionStatus(row);
  if (rejected) return { status: rejected };
  if (row.version !== input.expectedVersion) return { status: "conflict" };
  const identity = await insertCommandOperation(tx, workspaceId, {
    ...input,
    actor: userId,
    commandType: MARKET_VERIFICATION_COMMAND,
  });
  if (identity.status === "mismatch") {
    return { status: "idempotency_mismatch" };
  }
  if (identity.status === "replayed") {
    return {
      status: "replayed",
      analysis: row,
      operationId: identity.operation.id,
    };
  }
  const updated = await casUpdate(tx, workspaceId, row, {
    verificationIntentId: input.verificationIntentId,
    verificationIntentVersion: row.verificationIntentVersion + 1,
  });
  if (!updated) {
    throw new Error("market verification CAS failed after admission");
  }
  await tx.insert(outboxEvent).values({
    workspaceId,
    operationId: identity.operation.id,
    eventType: OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME,
    schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
    payload: {
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      workspaceId,
      marketAnalysisId: row.id,
      operationId: identity.operation.id,
    },
  });
  return {
    status: "updated",
    analysis: updated,
    operationId: identity.operation.id,
  };
}

async function enqueueChartRender(
  tx: Transaction,
  workspaceId: string,
  userId: string,
  row: AnalysisRow,
  input: Identity & {
    expectedVersion: number;
    chartRenderId: string;
    chartFingerprint: string;
    chartSpec: ChartSpec;
    renderContractVersion: string;
    approve: boolean;
  },
) {
  const replay = await readOperationIdentity(tx, workspaceId, {
    actor: userId,
    commandType: MARKET_CHART_RENDER_COMMAND,
    idempotencyKey: input.idempotencyKey,
  });
  if (replay) {
    return replay.requestHash === input.requestHash
      ? {
          status: "replayed" as const,
          analysis: row,
          operationId: replay.id,
        }
      : { status: "idempotency_mismatch" as const };
  }
  const rejected = admissionStatus(row);
  if (rejected) return { status: rejected };
  if (row.version !== input.expectedVersion) {
    return { status: "conflict" as const };
  }
  if (input.approve) {
    if (!row.currentSnapshotId) {
      return { status: "not_ready" as const };
    }
  } else if (row.chartApprovalFingerprint !== input.chartFingerprint) {
    return { status: "not_ready" as const };
  }
  const identity = await insertCommandOperation(tx, workspaceId, {
    ...input,
    actor: userId,
    commandType: MARKET_CHART_RENDER_COMMAND,
  });
  if (identity.status === "mismatch") {
    return { status: "idempotency_mismatch" as const };
  }
  if (identity.status === "replayed") {
    return {
      status: "replayed" as const,
      analysis: row,
      operationId: identity.operation.id,
    };
  }

  await tx.insert(marketChartRender).values({
    id: input.chartRenderId,
    workspaceId,
    marketAnalysisId: row.id,
    operationId: identity.operation.id,
    expectedChartFingerprint: input.chartFingerprint,
    renderContractVersion: input.renderContractVersion,
  });
  const chartChanged =
    !row.currentChartSpec ||
    materialChartSpec(row.currentChartSpec) !==
      materialChartSpec(input.chartSpec);
  const approval = input.approve
    ? {
        ...(chartChanged ? clearChartAndDownstream : {}),
        currentChartSpec: input.chartSpec,
        chartApprovalFingerprint: input.chartFingerprint,
        chartApprovedAt: new Date(),
        chartApprovedBy: userId,
      }
    : {};
  const updated = await casUpdate(tx, workspaceId, row, {
    ...approval,
    currentChartRenderId: input.chartRenderId,
    currentChartMediaAssetId: null,
  });
  if (!updated) {
    throw new Error("market chart render CAS failed after admission");
  }
  await tx.insert(outboxEvent).values({
    workspaceId,
    operationId: identity.operation.id,
    eventType: OPERATION_MARKET_CHART_RENDER_REQUESTED_EVENT_NAME,
    schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
    payload: {
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      workspaceId,
      marketAnalysisId: row.id,
      marketChartRenderId: input.chartRenderId,
      operationId: identity.operation.id,
    },
  });
  return {
    status: "updated" as const,
    analysis: updated,
    operationId: identity.operation.id,
  };
}

export async function approveMarketChart(
  executor: TransactionalExecutor,
  workspaceId: string,
  userId: string,
  input: Identity & {
    analysisId: string;
    expectedVersion: number;
    chartRenderId: string;
    chartFingerprint: string;
    chartSpec: ChartSpec;
    renderContractVersion: string;
  },
): Promise<CommandResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const row = await readOwnedAnalysisForUpdate(
      tx,
      workspaceId,
      userId,
      input.analysisId,
    );
    if (!row) return { status: "not_found" };
    return enqueueChartRender(tx, workspaceId, userId, row, {
      ...input,
      approve: true,
    });
  });
}

export async function retryMarketChartRender(
  executor: TransactionalExecutor,
  workspaceId: string,
  userId: string,
  input: Identity & {
    analysisId: string;
    expectedVersion: number;
    chartRenderId: string;
    chartFingerprint: string;
    chartSpec: ChartSpec;
    renderContractVersion: string;
  },
): Promise<CommandResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const row = await readOwnedAnalysisForUpdate(
      tx,
      workspaceId,
      userId,
      input.analysisId,
    );
    if (!row) return { status: "not_found" };
    return enqueueChartRender(tx, workspaceId, userId, row, {
      ...input,
      approve: false,
    });
  });
}

export async function approveMarketStage(
  executor: Executor,
  workspaceId: string,
  userId: string,
  input: {
    analysisId: string;
    expectedVersion: number;
    fingerprint: string;
    mediaChecksum: string;
  },
): Promise<CommandResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const row = await readOwnedAnalysisForUpdate(
      tx,
      workspaceId,
      userId,
      input.analysisId,
    );
    const rejected = admissionStatus(row);
    if (rejected || !row) return { status: rejected ?? "not_found" };
    if (row.version !== input.expectedVersion) return { status: "conflict" };
    const now = new Date();
    if (!row.designApprovalFingerprint || !row.currentFinalMediaAssetId) {
      return { status: "not_ready" };
    }
    const [asset] = await tx
      .select({ checksum: mediaAsset.checksum })
      .from(mediaAsset)
      .where(
        and(
          inWorkspace(mediaAsset, workspaceId),
          eq(mediaAsset.id, row.currentFinalMediaAssetId),
          eq(mediaAsset.lifecycle, "verified"),
        ),
      );
    if (!asset?.checksum || asset.checksum !== input.mediaChecksum) {
      return { status: "not_ready" };
    }
    const changes: Partial<typeof marketAnalysis.$inferInsert> = {
      finalApprovalFingerprint: input.fingerprint,
      finalApprovedAt: now,
      finalApprovedBy: userId,
    };
    const updated = await casUpdate(tx, workspaceId, row, changes);
    return updated
      ? { status: "updated", analysis: updated }
      : { status: "conflict" };
  });
}

export async function approveMarketDesign(
  executor: TransactionalExecutor,
  workspaceId: string,
  userId: string,
  input: {
    analysisId: string;
    expectedVersion: number;
    fingerprint: string;
    storyFingerprint: string;
    material: DesignMaterial;
  },
): Promise<CommandResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const row = await readOwnedAnalysisForUpdate(
      tx,
      workspaceId,
      userId,
      input.analysisId,
    );
    if (!row) return { status: "not_found" };
    const materialChanged =
      row.designFamilyKey !== input.material.familyKey ||
      row.designVariantKey !== input.material.variantKey;
    if (
      !materialChanged &&
      row.designApprovalFingerprint === input.fingerprint
    ) {
      return { status: "replayed", analysis: row };
    }
    const rejected = admissionStatus(row);
    if (rejected) return { status: rejected };
    if (row.version !== input.expectedVersion) return { status: "conflict" };
    if (
      row.storyApprovalFingerprint !== input.storyFingerprint ||
      !row.currentChartMediaAssetId
    ) {
      return { status: "not_ready" };
    }
    const updated = await casUpdate(tx, workspaceId, row, {
      ...(materialChanged ? { currentGenerationId: null, ...clearFinal } : {}),
      designFamilyKey: input.material.familyKey,
      designVariantKey: input.material.variantKey,
      designApprovalFingerprint: input.fingerprint,
      designApprovedAt: new Date(),
      designApprovedBy: userId,
    });
    if (!updated) {
      throw new Error("market design approval CAS failed after admission");
    }
    return { status: "updated", analysis: updated };
  });
}

export async function approveMarketStory(
  executor: Executor,
  workspaceId: string,
  userId: string,
  input: {
    analysisId: string;
    expectedVersion: number;
    headline: string;
    supportingText: string;
    fingerprint: string;
  },
): Promise<CommandResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const row = await readOwnedAnalysisForUpdate(
      tx,
      workspaceId,
      userId,
      input.analysisId,
    );
    if (!row) return { status: "not_found" };
    if (
      row.storyHeadline === input.headline &&
      row.storySupportingText === input.supportingText &&
      row.storyApprovalFingerprint === input.fingerprint
    ) {
      return { status: "replayed", analysis: row };
    }
    const rejected = admissionStatus(row);
    if (rejected) return { status: rejected };
    if (row.version !== input.expectedVersion) return { status: "conflict" };
    if (!row.chartApprovalFingerprint) return { status: "not_ready" };
    const storyChanged =
      row.storyHeadline !== input.headline ||
      row.storySupportingText !== input.supportingText;
    const updated = await casUpdate(tx, workspaceId, row, {
      ...(storyChanged ? clearDesignAndFinal : {}),
      storyHeadline: input.headline,
      storySupportingText: input.supportingText,
      storyApprovalFingerprint: input.fingerprint,
      storyApprovedAt: new Date(),
      storyApprovedBy: userId,
    });
    return updated
      ? { status: "updated", analysis: updated }
      : { status: "conflict" };
  });
}

export async function finishMarketAnalysis(
  executor: Executor,
  workspaceId: string,
  userId: string,
  input: {
    analysisId: string;
    expectedVersion: number;
    finalFingerprint: string;
  },
): Promise<CommandResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const row = await readOwnedAnalysisForUpdate(
      tx,
      workspaceId,
      userId,
      input.analysisId,
    );
    const rejected = admissionStatus(row);
    if (rejected || !row) return { status: rejected ?? "not_found" };
    if (row.version !== input.expectedVersion) return { status: "conflict" };
    if (
      !row.currentFinalMediaAssetId ||
      row.finalApprovalFingerprint !== input.finalFingerprint
    ) {
      return { status: "not_ready" };
    }
    const activeIds = [row.verificationIntentId].filter(
      (value): value is string => value !== null,
    );
    if (row.currentChartRenderId) {
      const [render] = await tx
        .select({ operationId: marketChartRender.operationId })
        .from(marketChartRender)
        .where(
          and(
            inWorkspace(marketChartRender, workspaceId),
            eq(marketChartRender.id, row.currentChartRenderId),
          ),
        );
      if (render) activeIds.push(render.operationId);
    }
    if (row.currentGenerationId) {
      const [generation] = await tx
        .select({ operationId: marketGeneration.operationId })
        .from(marketGeneration)
        .where(
          and(
            inWorkspace(marketGeneration, workspaceId),
            eq(marketGeneration.id, row.currentGenerationId),
          ),
        );
      if (generation) activeIds.push(generation.operationId);
    }
    if (activeIds.length > 0) {
      const active = await tx
        .select({ id: operation.id })
        .from(operation)
        .where(
          and(
            inWorkspace(operation, workspaceId),
            inArray(operation.id, activeIds),
            inArray(operation.lifecycle, ["queued", "running", "settling"]),
          ),
        )
        .limit(1);
      if (active.length > 0) return { status: "not_ready" };
    }
    const now = new Date();
    const updated = await casUpdate(tx, workspaceId, row, {
      status: "completed",
      completedAt: now,
      completedBy: userId,
    });
    return updated
      ? { status: "updated", analysis: updated }
      : { status: "conflict" };
  });
}

export async function saveOwnedMarketChartDefault(
  executor: Executor,
  workspaceId: string,
  userId: string,
  input: {
    marketInstrumentId: string;
    chartSpec: ChartSpec;
    expectedVersion: number | null;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    if (input.expectedVersion === null) {
      const [created] = await tx
        .insert(marketChartDefault)
        .values({
          workspaceId,
          actorId: userId,
          marketInstrumentId: input.marketInstrumentId,
          normalizedChartSpec: input.chartSpec,
        })
        .onConflictDoNothing({
          target: [
            marketChartDefault.workspaceId,
            marketChartDefault.actorId,
            marketChartDefault.marketInstrumentId,
          ],
        })
        .returning();
      return created
        ? { status: "updated" as const, chartDefault: created }
        : { status: "conflict" as const };
    }
    const [updated] = await tx
      .update(marketChartDefault)
      .set({
        normalizedChartSpec: input.chartSpec,
        updatedAt: new Date(),
        version: input.expectedVersion + 1,
      })
      .where(
        and(
          inWorkspace(marketChartDefault, workspaceId),
          eq(marketChartDefault.actorId, userId),
          eq(marketChartDefault.marketInstrumentId, input.marketInstrumentId),
          eq(marketChartDefault.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated
      ? { status: "updated" as const, chartDefault: updated }
      : { status: "conflict" as const };
  });
}
