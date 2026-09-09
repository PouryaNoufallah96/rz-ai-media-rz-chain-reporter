import type {
  InvocationKey,
  ModelBackend,
  UsageApiKind,
  UsageCostAuthority,
  UsageProviderGateway,
  UsageStatus,
} from "@rz-chain-reporter/contracts";
import { and, eq, gt, sql } from "drizzle-orm";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import {
  type AiUsageRawMetadata,
  aiUsageEvent,
} from "../schema/ai-usage-event";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";

type AiUsageEventRow = typeof aiUsageEvent.$inferSelect;
type TerminalUsageStatus = Exclude<UsageStatus, "pending">;

export type InsertPendingUsageInput = {
  operationId: string;
  operationAttemptId: string;
  invocationKey: InvocationKey;
  callIndex?: number;
  taskKey: string;
  apiKind: UsageApiKind;
  backend: ModelBackend;
  providerGateway: UsageProviderGateway;
  requestedModel: string;
  claimFence?: {
    claimedBy: string;
    expectedVersion: number;
    now: Date;
  };
  occurredAt?: Date;
};

export type InsertPendingUsageResult = {
  event: AiUsageEventRow;
  inserted: boolean;
};

export async function insertPendingUsage(
  executor: Executor,
  workspaceId: string,
  input: InsertPendingUsageInput,
): Promise<InsertPendingUsageResult> {
  const callIndex = input.callIndex ?? 0;
  if (!Number.isInteger(callIndex) || callIndex < 0) {
    throw new Error("usage call index must be a nonnegative integer");
  }

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    if (input.claimFence) {
      const [owner] = await tx
        .select({ id: operation.id })
        .from(operation)
        .where(
          and(
            inWorkspace(operation, workspaceId),
            eq(operation.id, input.operationId),
            eq(operation.claimedBy, input.claimFence.claimedBy),
            eq(operation.version, input.claimFence.expectedVersion),
            eq(operation.lifecycle, "running"),
            gt(operation.leaseExpiresAt, input.claimFence.now),
          ),
        )
        .for("update");
      if (!owner) throw new Error("usage invocation claim fence lost");
    }
    const [attempt] = await tx
      .select({ id: operationAttempt.id })
      .from(operationAttempt)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.id, input.operationAttemptId),
          eq(operationAttempt.operationId, input.operationId),
        ),
      );

    if (!attempt) {
      throw new Error("usage invocation operation-attempt identity mismatch");
    }

    const occurredAt = input.occurredAt ?? new Date();
    const [inserted] = await tx
      .insert(aiUsageEvent)
      .values({
        workspaceId,
        operationId: input.operationId,
        operationAttemptId: input.operationAttemptId,
        invocationKey: input.invocationKey,
        callIndex,
        taskKey: input.taskKey,
        apiKind: input.apiKind,
        backend: input.backend,
        providerGateway: input.providerGateway,
        requestedModel: input.requestedModel,
        occurredAt,
      })
      .onConflictDoNothing({
        target: [
          aiUsageEvent.operationAttemptId,
          aiUsageEvent.invocationKey,
          aiUsageEvent.callIndex,
        ],
      })
      .returning();

    if (inserted) {
      return { event: inserted, inserted: true };
    }

    const [existing] = await tx
      .select()
      .from(aiUsageEvent)
      .where(
        and(
          inWorkspace(aiUsageEvent, workspaceId),
          eq(aiUsageEvent.operationAttemptId, input.operationAttemptId),
          eq(aiUsageEvent.invocationKey, input.invocationKey),
          eq(aiUsageEvent.callIndex, callIndex),
        ),
      );

    if (!existing) {
      throw new Error("usage invocation conflict returned no row");
    }
    if (
      existing.operationId !== input.operationId ||
      existing.taskKey !== input.taskKey ||
      existing.apiKind !== input.apiKind ||
      existing.backend !== input.backend ||
      existing.providerGateway !== input.providerGateway ||
      existing.requestedModel !== input.requestedModel
    ) {
      throw new Error("usage invocation identity mismatch");
    }

    return { event: existing, inserted: false };
  });
}

export type FinalizeUsageInput = {
  id: string;
  status: TerminalUsageStatus;
  failureRetryable?: boolean | null;
  resolvedModel?: string | null;
  upstreamProvider?: string | null;
  generationId?: string | null;
  providerRequestId?: string | null;
  finishReason?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  reasoningTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  totalTokens?: number | null;
  openrouterCost?: string | null;
  upstreamInferenceCost?: string | null;
  costAuthority: UsageCostAuthority;
  rawUsage?: AiUsageRawMetadata | null;
  finalizedAt?: Date;
  claimFence?: {
    operationId: string;
    claimedBy: string;
    expectedVersion: number;
    now?: Date;
  };
};

export type FinalizeUsageResult =
  | { status: "updated"; event: AiUsageEventRow }
  | { status: "unchanged"; event: AiUsageEventRow }
  | { status: "not_found" };

export async function finalizeUsage(
  executor: Executor,
  workspaceId: string,
  input: FinalizeUsageInput,
): Promise<FinalizeUsageResult> {
  const finalizedAt = input.finalizedAt ?? new Date();

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    await assertUsageClaimFence(tx, workspaceId, input.claimFence);
    const [updated] = await tx
      .update(aiUsageEvent)
      .set({
        status: input.status,
        failureRetryable: input.failureRetryable,
        resolvedModel: input.resolvedModel,
        upstreamProvider: input.upstreamProvider,
        generationId: input.generationId,
        providerRequestId: input.providerRequestId,
        finishReason: input.finishReason,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        reasoningTokens: input.reasoningTokens,
        cacheReadTokens: input.cacheReadTokens,
        cacheWriteTokens: input.cacheWriteTokens,
        totalTokens: input.totalTokens,
        openrouterCost: input.openrouterCost,
        upstreamInferenceCost: input.upstreamInferenceCost,
        costAuthority: input.costAuthority,
        rawUsage: input.rawUsage,
        updatedAt: finalizedAt,
      })
      .where(
        and(
          inWorkspace(aiUsageEvent, workspaceId),
          eq(aiUsageEvent.id, input.id),
          eq(aiUsageEvent.status, "pending"),
        ),
      )
      .returning();

    if (updated) {
      return { status: "updated", event: updated };
    }

    const [existing] = await tx
      .select()
      .from(aiUsageEvent)
      .where(
        and(
          inWorkspace(aiUsageEvent, workspaceId),
          eq(aiUsageEvent.id, input.id),
        ),
      );

    return existing
      ? { status: "unchanged", event: existing }
      : { status: "not_found" };
  });
}

export async function markPendingAttemptUsageUnknown(
  executor: Executor,
  workspaceId: string,
  operationAttemptId: string,
): Promise<number> {
  const rows = await executor
    .update(aiUsageEvent)
    .set({
      costAuthority: "unknown",
      status: "unknown",
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(aiUsageEvent, workspaceId),
        eq(aiUsageEvent.operationAttemptId, operationAttemptId),
        eq(aiUsageEvent.status, "pending"),
      ),
    )
    .returning({ id: aiUsageEvent.id });

  return rows.length;
}

export type FinalizeUsageWithResultResult<TResult> =
  | { status: "updated"; event: AiUsageEventRow; result: TResult }
  | { status: "unchanged"; event: AiUsageEventRow }
  | { status: "not_found" };

export async function finalizeUsageWithResult<TResult>(
  executor: Executor,
  workspaceId: string,
  input: FinalizeUsageInput,
  persistResult: (tx: Transaction) => Promise<TResult>,
): Promise<FinalizeUsageWithResultResult<TResult>> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    await assertUsageClaimFence(tx, workspaceId, input.claimFence);

    const [existing] = await tx
      .select()
      .from(aiUsageEvent)
      .where(
        and(
          inWorkspace(aiUsageEvent, workspaceId),
          eq(aiUsageEvent.id, input.id),
        ),
      )
      .for("update");

    if (!existing) {
      return { status: "not_found" };
    }

    if (existing.status !== "pending") {
      return { status: "unchanged", event: existing };
    }

    const result = await persistResult(tx);
    const finalizedAt = input.finalizedAt ?? new Date();
    const [updated] = await tx
      .update(aiUsageEvent)
      .set({
        status: input.status,
        failureRetryable: input.failureRetryable,
        resolvedModel: input.resolvedModel,
        upstreamProvider: input.upstreamProvider,
        generationId: input.generationId,
        providerRequestId: input.providerRequestId,
        finishReason: input.finishReason,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        reasoningTokens: input.reasoningTokens,
        cacheReadTokens: input.cacheReadTokens,
        cacheWriteTokens: input.cacheWriteTokens,
        totalTokens: input.totalTokens,
        openrouterCost: input.openrouterCost,
        upstreamInferenceCost: input.upstreamInferenceCost,
        costAuthority: input.costAuthority,
        rawUsage: input.rawUsage,
        updatedAt: finalizedAt,
      })
      .where(
        and(
          inWorkspace(aiUsageEvent, workspaceId),
          eq(aiUsageEvent.id, input.id),
          eq(aiUsageEvent.status, "pending"),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error("usage finalization lost its pending row lock");
    }

    return { status: "updated", event: updated, result };
  });
}

async function assertUsageClaimFence(
  tx: Transaction,
  workspaceId: string,
  fence: FinalizeUsageInput["claimFence"],
) {
  if (!fence) return;
  const [owner] = await tx
    .select({ id: operation.id })
    .from(operation)
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, fence.operationId),
        eq(operation.claimedBy, fence.claimedBy),
        eq(operation.version, fence.expectedVersion),
        eq(operation.lifecycle, "running"),
        gt(operation.leaseExpiresAt, fence.now ?? new Date()),
      ),
    )
    .for("update");
  if (!owner) throw new Error("usage finalization claim fence lost");
}

export type EnrichUsageInput = {
  id: string;
  status?: TerminalUsageStatus;
  resolvedModel?: string;
  upstreamProvider?: string;
  generationId?: string;
  providerRequestId?: string;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  openrouterCost?: string;
  upstreamInferenceCost?: string;
  costAuthority?: UsageCostAuthority;
  rawUsage?: AiUsageRawMetadata;
  reconciledAt?: Date;
};

export async function enrichUsage(
  executor: Executor,
  workspaceId: string,
  input: EnrichUsageInput,
): Promise<AiUsageEventRow | null> {
  const reconciledAt = input.reconciledAt ?? new Date();

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [updated] = await tx
      .update(aiUsageEvent)
      .set({
        status: input.status
          ? sql`case when ${aiUsageEvent.status} in ('pending', 'unknown') then ${input.status}::usage_status else ${aiUsageEvent.status} end`
          : aiUsageEvent.status,
        resolvedModel: sql`coalesce(${aiUsageEvent.resolvedModel}, ${input.resolvedModel ?? null})`,
        upstreamProvider: sql`coalesce(${aiUsageEvent.upstreamProvider}, ${input.upstreamProvider ?? null})`,
        generationId: sql`coalesce(${aiUsageEvent.generationId}, ${input.generationId ?? null})`,
        providerRequestId: sql`coalesce(${aiUsageEvent.providerRequestId}, ${input.providerRequestId ?? null})`,
        finishReason: sql`coalesce(${aiUsageEvent.finishReason}, ${input.finishReason ?? null})`,
        promptTokens: sql`coalesce(${aiUsageEvent.promptTokens}, ${input.promptTokens ?? null})`,
        completionTokens: sql`coalesce(${aiUsageEvent.completionTokens}, ${input.completionTokens ?? null})`,
        reasoningTokens: sql`coalesce(${aiUsageEvent.reasoningTokens}, ${input.reasoningTokens ?? null})`,
        cacheReadTokens: sql`coalesce(${aiUsageEvent.cacheReadTokens}, ${input.cacheReadTokens ?? null})`,
        cacheWriteTokens: sql`coalesce(${aiUsageEvent.cacheWriteTokens}, ${input.cacheWriteTokens ?? null})`,
        totalTokens: sql`coalesce(${aiUsageEvent.totalTokens}, ${input.totalTokens ?? null})`,
        openrouterCost: sql`coalesce(${aiUsageEvent.openrouterCost}, ${input.openrouterCost ?? null})`,
        upstreamInferenceCost: sql`coalesce(${aiUsageEvent.upstreamInferenceCost}, ${input.upstreamInferenceCost ?? null})`,
        costAuthority: input.costAuthority
          ? sql`case when ${aiUsageEvent.costAuthority} = 'unknown' then ${input.costAuthority}::usage_cost_authority else ${aiUsageEvent.costAuthority} end`
          : aiUsageEvent.costAuthority,
        usageSource: "generation_reconciled",
        reconciledAt: sql`coalesce(${aiUsageEvent.reconciledAt}, ${reconciledAt})`,
        rawUsage: input.rawUsage
          ? sql`${JSON.stringify(input.rawUsage)}::jsonb || coalesce(${aiUsageEvent.rawUsage}, '{}'::jsonb)`
          : aiUsageEvent.rawUsage,
        updatedAt: reconciledAt,
      })
      .where(
        and(
          inWorkspace(aiUsageEvent, workspaceId),
          eq(aiUsageEvent.id, input.id),
        ),
      )
      .returning();

    return updated ?? null;
  });
}
