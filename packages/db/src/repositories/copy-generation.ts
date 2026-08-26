import type {
  ArticleFetchMode,
  ContentLocale,
  EnrichmentReason,
  ErrorCode,
  InvocationKey,
  OperationLifecycle,
  Platform,
  UsageStatus,
} from "@rz-chain-reporter/contracts";
import {
  COPY_GENERATION_COMMAND_PREFIX,
  DURABLE_EVENT_SCHEMA_VERSION,
  OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import { aiUsageEvent } from "../schema/ai-usage-event";
import { analysisModelUnit } from "../schema/analysis-model-unit";
import { analysisRun } from "../schema/analysis-run";
import { analysisRunItem } from "../schema/analysis-run-item";
import { copyGeneration } from "../schema/copy-generation";
import { copyGenerationUnit } from "../schema/copy-generation-unit";
import { copyVariant } from "../schema/copy-variant";
import { editorialSelection } from "../schema/editorial-selection";
import { filterResult } from "../schema/filter-result";
import { mediaBrand } from "../schema/media-brand";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";
import { outboxEvent } from "../schema/outbox-event";
import { platformDraft } from "../schema/platform-draft";
import { promoIdea } from "../schema/promo-idea";
import { source } from "../schema/source";
import { sourceItem } from "../schema/source-item";
import { sourceItemEnrichment } from "../schema/source-item-enrichment";
import { sourceItemRevision } from "../schema/source-item-revision";
import { matchesAppliedCustomerTemplate } from "./customer-template-identity";
import {
  claimOperationExecution,
  insertOperationIdentity,
  readOperationIdentity,
  resolveOperationIdentityConflict,
} from "./operation";
import {
  allocateOperationAttemptInTransaction,
  settleOperationAttempt,
} from "./operation-attempt";
import {
  findRevisionEnrichment,
  findRevisionPageEnrichment,
  insertSourceItemEnrichment,
} from "./source-import";

export const COPY_PAGE_EXTRACT_POLICY = "extract-v1:page";

type CopySourceKind = "promo" | "rss" | "telegram";

export type CopySourceBindingResult = {
  kind: CopySourceKind;
  limited: boolean;
  pageFetch: "failed" | "interrupted" | "not_needed" | "succeeded";
  status: "bound" | "no_input";
};

export type CopyPageFetchClaim = {
  attemptId: string;
  endpoint: string;
  mode: ArticleFetchMode;
  reason: "below_minimum" | "explicit_refresh" | "feed_only" | "missing";
  sourceItemRevisionId: string;
  url: string;
};

export type PrepareCopySourceResult =
  | CopySourceBindingResult
  | { status: "fetch_required"; claim: CopyPageFetchClaim }
  | { status: "not_found" };

export type CompleteCopyPageFetchInput = {
  attemptId: string;
  adapter: "direct" | "firecrawl";
  extract: string;
  fallbackReason: EnrichmentReason | null;
  pageContentHash: string;
  sourceItemRevisionId: string;
};

export type FailCopyPageFetchInput = {
  attemptId: string;
  reason: EnrichmentReason;
};

export type BoundCopySourceInput =
  | {
      kind: "rss";
      content: string;
      limited: boolean;
      pageContentHash: string | null;
      sourceItemEnrichmentId: string | null;
      sourceItemRevisionId: string;
    }
  | {
      kind: "telegram";
      content: string;
      contentHash: string;
      sourceItemRevisionId: string;
    }
  | {
      kind: "promo";
      angle: string;
      description: string;
      promoIdeaId: string;
      title: string;
    };

export type CreateCopyGenerationInput = {
  operationId: string;
  platformDraftId: string;
  requestedContentLocale: ContentLocale;
  modelOptionKey: string;
  variantKeys: readonly string[];
  customerTemplateFingerprint: string;
  brandPolicyFingerprint: string;
  promptVersion: string;
  configurationVersion: string;
  forceArticleRefresh?: boolean;
};

export async function insertCopyGeneration(
  tx: Transaction,
  workspaceId: string,
  input: CreateCopyGenerationInput,
) {
  await tx.insert(copyGeneration).values({
    operationId: input.operationId,
    workspaceId,
    platformDraftId: input.platformDraftId,
    requestedContentLocale: input.requestedContentLocale,
    modelOptionKey: input.modelOptionKey,
    customerTemplateFingerprint: input.customerTemplateFingerprint,
    brandPolicyFingerprint: input.brandPolicyFingerprint,
    promptVersion: input.promptVersion,
    configurationVersion: input.configurationVersion,
    forceArticleRefresh: input.forceArticleRefresh ?? false,
  });

  await tx.insert(copyGenerationUnit).values(
    input.variantKeys.map((variantKey) => ({
      workspaceId,
      copyGenerationId: input.operationId,
      variantKey,
    })),
  );
}

type StartCopyOperationBase = {
  actor: string;
  idempotencyKey: string;
  platformDraftId: string;
  requestHash: string;
  requestId: string | null;
};

type CopyGenerationVersionIdentity = Pick<
  CreateCopyGenerationInput,
  | "brandPolicyFingerprint"
  | "configurationVersion"
  | "customerTemplateFingerprint"
  | "promptVersion"
>;

export type StartCopyOperationInput = StartCopyOperationBase &
  CopyGenerationVersionIdentity &
  (
    | {
        mode: "regenerate" | "refresh_article";
        requestedContentLocale: ContentLocale;
        modelOptionKey: string;
        variantKeys: readonly string[];
      }
    | { mode: "retry_failed" }
  );

export type StartCopyOperationResult =
  | {
      status: "created" | "replayed";
      operationId: string;
      lifecycle: OperationLifecycle;
    }
  | {
      status:
        | "idempotency_mismatch"
        | "not_found"
        | "operation_in_progress"
        | "no_failed_units"
        | "refresh_not_supported"
        | "template_drift";
    };

export async function readCopyOperationDraftContext(
  executor: Executor,
  workspaceId: string,
  platformDraftId: string,
) {
  const [draft] = await executor
    .select({
      brandKey: mediaBrand.key,
      id: platformDraft.id,
      mediaBrandId: platformDraft.mediaBrandId,
      platform: platformDraft.platform,
    })
    .from(platformDraft)
    .innerJoin(
      mediaBrand,
      and(
        inWorkspace(mediaBrand, workspaceId),
        eq(mediaBrand.id, platformDraft.mediaBrandId),
      ),
    )
    .where(
      and(
        inWorkspace(platformDraft, workspaceId),
        eq(platformDraft.id, platformDraftId),
        isNull(platformDraft.deletedAt),
      ),
    );
  return draft ?? null;
}

export async function startCopyOperation(
  executor: Executor,
  workspaceId: string,
  input: StartCopyOperationInput,
): Promise<StartCopyOperationResult> {
  const identity = operationIdentity(input);
  const fastIdentity = await readOperationIdentity(
    executor,
    workspaceId,
    identity,
  );
  if (fastIdentity) return copyOperationReplay(fastIdentity, input.requestHash);

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('copy-generation-command'), hashtext(${`${workspaceId}:${input.platformDraftId}`}))`,
    );

    const existing = await readOperationIdentity(tx, workspaceId, identity);
    if (existing) return copyOperationReplay(existing, input.requestHash);

    if (
      !(await matchesAppliedCustomerTemplate(
        tx,
        workspaceId,
        input.customerTemplateFingerprint,
      ))
    ) {
      return { status: "template_drift" };
    }

    const [draft] = await tx
      .select({ id: platformDraft.id })
      .from(platformDraft)
      .where(
        and(
          inWorkspace(platformDraft, workspaceId),
          eq(platformDraft.id, input.platformDraftId),
          isNull(platformDraft.deletedAt),
        ),
      );
    if (!draft) return { status: "not_found" };

    if (input.mode === "refresh_article") {
      const origin = await loadCopyOrigin(
        tx,
        workspaceId,
        input.platformDraftId,
      );
      if (origin?.kind !== "rss") {
        return { status: "refresh_not_supported" };
      }
    }

    const [nonterminal] = await tx
      .select({ id: operation.id })
      .from(copyGeneration)
      .innerJoin(
        operation,
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, copyGeneration.operationId),
          inArray(operation.lifecycle, ["queued", "running", "settling"]),
        ),
      )
      .where(
        and(
          inWorkspace(copyGeneration, workspaceId),
          eq(copyGeneration.platformDraftId, input.platformDraftId),
        ),
      )
      .limit(1);
    if (nonterminal) return { status: "operation_in_progress" };

    let generationInput: Omit<
      CreateCopyGenerationInput,
      "operationId" | "platformDraftId"
    >;
    if (input.mode === "retry_failed") {
      const retry = await retryGenerationInput(
        tx,
        workspaceId,
        input.platformDraftId,
        input,
      );
      if (retry.status === "none") {
        return { status: "no_failed_units" };
      }
      generationInput = retry.input;
    } else {
      generationInput = {
        requestedContentLocale: input.requestedContentLocale,
        modelOptionKey: input.modelOptionKey,
        variantKeys: input.variantKeys,
        customerTemplateFingerprint: input.customerTemplateFingerprint,
        brandPolicyFingerprint: input.brandPolicyFingerprint,
        promptVersion: input.promptVersion,
        configurationVersion: input.configurationVersion,
        forceArticleRefresh: input.mode === "refresh_article",
      };
    }

    let created: typeof operation.$inferSelect;
    try {
      created = await insertOperationIdentity(tx, workspaceId, {
        ...identity,
      });
    } catch (error) {
      const conflict = await resolveOperationIdentityConflict(
        tx,
        workspaceId,
        identity,
        error,
      );
      if (conflict.status === "mismatch") {
        return { status: "idempotency_mismatch" };
      }
      return {
        status: "replayed",
        operationId: conflict.operation.id,
        lifecycle: conflict.operation.lifecycle,
      };
    }

    await insertCopyGeneration(tx, workspaceId, {
      operationId: created.id,
      platformDraftId: input.platformDraftId,
      ...generationInput,
    });
    await tx.insert(outboxEvent).values({
      workspaceId,
      operationId: created.id,
      eventType: OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME,
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      payload: {
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        workspaceId,
        operationId: created.id,
      },
    });

    return {
      status: "created",
      operationId: created.id,
      lifecycle: created.lifecycle,
    };
  });
}

function operationIdentity(input: StartCopyOperationInput) {
  return {
    actor: input.actor,
    commandType: `${COPY_GENERATION_COMMAND_PREFIX}${input.mode}`,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    requestId: input.requestId,
  };
}

function copyOperationReplay(
  existing: typeof operation.$inferSelect,
  requestHash: string,
): StartCopyOperationResult {
  return existing.requestHash === requestHash
    ? {
        status: "replayed",
        operationId: existing.id,
        lifecycle: existing.lifecycle,
      }
    : { status: "idempotency_mismatch" };
}

async function retryGenerationInput(
  tx: Transaction,
  workspaceId: string,
  platformDraftId: string,
  identity: CopyGenerationVersionIdentity,
) {
  const [latest] = await tx
    .select()
    .from(copyGeneration)
    .where(
      and(
        inWorkspace(copyGeneration, workspaceId),
        eq(copyGeneration.platformDraftId, platformDraftId),
      ),
    )
    .orderBy(desc(copyGeneration.createdAt), desc(copyGeneration.operationId))
    .limit(1);
  if (!latest) return { status: "none" as const };
  const failedUnits = await tx
    .select({ variantKey: copyGenerationUnit.variantKey })
    .from(copyGenerationUnit)
    .where(
      and(
        inWorkspace(copyGenerationUnit, workspaceId),
        eq(copyGenerationUnit.copyGenerationId, latest.operationId),
        eq(copyGenerationUnit.status, "failed"),
      ),
    )
    .orderBy(asc(copyGenerationUnit.createdAt), asc(copyGenerationUnit.id));
  if (failedUnits.length === 0) return { status: "none" as const };

  return {
    status: "ready" as const,
    input: {
      requestedContentLocale: latest.requestedContentLocale,
      modelOptionKey: latest.modelOptionKey,
      variantKeys: failedUnits.map((unit) => unit.variantKey),
      customerTemplateFingerprint: identity.customerTemplateFingerprint,
      brandPolicyFingerprint: identity.brandPolicyFingerprint,
      promptVersion: identity.promptVersion,
      configurationVersion: identity.configurationVersion,
      forceArticleRefresh: false,
    },
  };
}

export async function prepareCopyGenerationSource(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  fetchMinimumChars: number,
): Promise<PrepareCopySourceResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    const generation = await lockCopyGeneration(tx, workspaceId, operationId);
    if (!generation) return { status: "not_found" };

    const origin = await loadCopyOrigin(
      tx,
      workspaceId,
      generation.platformDraftId,
    );
    if (!origin) return { status: "not_found" };

    if (origin.kind === "promo") {
      return boundResult("promo", false, "not_needed", true);
    }

    if (generation.sourceItemRevisionId !== null) {
      return boundResult(
        origin.kind,
        generation.limited,
        "not_needed",
        sourceText(origin) !== "",
      );
    }

    if (origin.kind === "telegram") {
      if (generation.forceArticleRefresh) {
        throw new Error("telegram copy generation requested article refresh");
      }
      await bindSourceRevision(
        tx,
        workspaceId,
        operationId,
        origin.revisionId,
        {
          limited: false,
          limitedReason: null,
        },
      );
      return boundResult(
        "telegram",
        false,
        "not_needed",
        sourceText(origin) !== "",
      );
    }

    const priorPage = await findRevisionPageEnrichment(
      tx,
      workspaceId,
      origin.revisionId,
    );

    if (generation.pageFetchOperationAttemptId !== null) {
      await settleOperationAttempt(tx, workspaceId, {
        id: generation.pageFetchOperationAttemptId,
        outcome: "ambiguous",
      });
      if (priorPage) {
        await bindPageEnrichment(
          tx,
          workspaceId,
          operationId,
          origin.revisionId,
          priorPage,
        );
        return boundResult("rss", false, "interrupted", true);
      }
      const hasInput = sourceText(origin) !== "";
      await bindSourceRevision(
        tx,
        workspaceId,
        operationId,
        origin.revisionId,
        {
          limited: true,
          limitedReason: "fetch_failed",
        },
      );
      return boundResult("rss", true, "interrupted", hasInput);
    }

    if (priorPage && !generation.forceArticleRefresh) {
      await bindPageEnrichment(
        tx,
        workspaceId,
        operationId,
        origin.revisionId,
        priorPage,
      );
      return boundResult("rss", false, "not_needed", true);
    }

    const current = await findRevisionEnrichment(tx, workspaceId, {
      sourceItemRevisionId: origin.revisionId,
      extractPolicy: "extract-v1",
    });
    const reason = generation.forceArticleRefresh
      ? "explicit_refresh"
      : current === undefined
        ? "missing"
        : current.extract.length < fetchMinimumChars
          ? "below_minimum"
          : "feed_only";
    const attempt = await allocateOperationAttemptInTransaction(
      tx,
      workspaceId,
      operationId,
    );
    if (!attempt) return { status: "not_found" };

    const [claimed] = await tx
      .update(copyGeneration)
      .set({
        pageFetchOperationAttemptId: attempt.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          inWorkspace(copyGeneration, workspaceId),
          eq(copyGeneration.operationId, operationId),
          isNull(copyGeneration.pageFetchOperationAttemptId),
          isNull(copyGeneration.sourceItemRevisionId),
        ),
      )
      .returning({ operationId: copyGeneration.operationId });
    if (!claimed) throw new Error("copy page-fetch claim lost under row lock");

    return {
      status: "fetch_required",
      claim: {
        attemptId: attempt.id,
        endpoint: origin.endpoint,
        mode: origin.articleFetchMode,
        reason,
        sourceItemRevisionId: origin.revisionId,
        url: origin.canonicalUrl,
      },
    };
  });
}

export async function completeCopyGenerationPageFetch(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  input: CompleteCopyPageFetchInput,
): Promise<CopySourceBindingResult | { status: "not_found" }> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const generation = await lockCopyGeneration(tx, workspaceId, operationId);
    if (!generation) return { status: "not_found" };
    if (generation.sourceItemRevisionId !== null) {
      return boundResult("rss", generation.limited, "not_needed", true);
    }
    if (generation.pageFetchOperationAttemptId !== input.attemptId) {
      throw new Error("copy page-fetch attempt identity changed");
    }

    const origin = await loadCopyOrigin(
      tx,
      workspaceId,
      generation.platformDraftId,
    );
    if (origin?.kind !== "rss") {
      throw new Error("copy page-fetch origin is not RSS");
    }
    if (origin.revisionId !== input.sourceItemRevisionId) {
      throw new Error("copy page-fetch source revision changed");
    }

    const enrichmentId = await insertSourceItemEnrichment(tx, workspaceId, {
      sourceItemRevisionId: origin.revisionId,
      operationAttemptId: input.attemptId,
      policyVersion: COPY_PAGE_EXTRACT_POLICY,
      adapter: input.adapter,
      fallbackReason: input.fallbackReason,
      pageContentHash: input.pageContentHash,
      extract: input.extract,
      brief: null,
      providerRequestId: null,
    });
    await settleOperationAttempt(tx, workspaceId, {
      id: input.attemptId,
      outcome: "succeeded",
    });
    await bindPageEnrichment(tx, workspaceId, operationId, origin.revisionId, {
      id: enrichmentId,
      pageContentHash: input.pageContentHash,
    });
    return boundResult("rss", false, "succeeded", true);
  });
}

export async function failCopyGenerationPageFetch(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  input: FailCopyPageFetchInput,
): Promise<CopySourceBindingResult | { status: "not_found" }> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const generation = await lockCopyGeneration(tx, workspaceId, operationId);
    if (!generation) return { status: "not_found" };
    if (generation.sourceItemRevisionId !== null) {
      return boundResult("rss", generation.limited, "not_needed", true);
    }
    if (generation.pageFetchOperationAttemptId !== input.attemptId) {
      throw new Error("copy page-fetch attempt identity changed");
    }

    const origin = await loadCopyOrigin(
      tx,
      workspaceId,
      generation.platformDraftId,
    );
    if (origin?.kind !== "rss") {
      throw new Error("copy page-fetch origin is not RSS");
    }

    await settleOperationAttempt(tx, workspaceId, {
      id: input.attemptId,
      outcome: "failed_terminal",
    });
    const priorPage = await findRevisionPageEnrichment(
      tx,
      workspaceId,
      origin.revisionId,
    );
    if (priorPage) {
      await bindPageEnrichment(
        tx,
        workspaceId,
        operationId,
        origin.revisionId,
        priorPage,
      );
      return boundResult("rss", false, "failed", true);
    }

    const hasInput = sourceText(origin) !== "";
    await bindSourceRevision(tx, workspaceId, operationId, origin.revisionId, {
      limited: true,
      limitedReason: input.reason,
    });
    return boundResult("rss", true, "failed", hasInput);
  });
}

export async function loadBoundCopyGenerationSourceInput(
  executor: Executor,
  workspaceId: string,
  operationId: string,
): Promise<BoundCopySourceInput | null> {
  const [generation] = await executor
    .select()
    .from(copyGeneration)
    .where(
      and(
        inWorkspace(copyGeneration, workspaceId),
        eq(copyGeneration.operationId, operationId),
      ),
    );
  if (!generation) return null;

  const origin = await loadCopyOrigin(
    executor,
    workspaceId,
    generation.platformDraftId,
  );
  if (!origin) return null;
  if (origin.kind === "promo") {
    return {
      kind: "promo",
      angle: origin.angle,
      description: origin.description,
      promoIdeaId: origin.promoIdeaId,
      title: origin.title,
    };
  }
  if (generation.sourceItemRevisionId !== origin.revisionId) return null;
  if (origin.kind === "telegram") {
    return {
      kind: "telegram",
      content: sourceText(origin),
      contentHash: origin.contentHash,
      sourceItemRevisionId: origin.revisionId,
    };
  }
  if (generation.sourceItemEnrichmentId !== null) {
    const [enrichment] = await executor
      .select({
        extract: sourceItemEnrichment.extract,
        pageContentHash: sourceItemEnrichment.pageContentHash,
      })
      .from(sourceItemEnrichment)
      .where(
        and(
          inWorkspace(sourceItemEnrichment, workspaceId),
          eq(sourceItemEnrichment.id, generation.sourceItemEnrichmentId),
          eq(sourceItemEnrichment.sourceItemRevisionId, origin.revisionId),
          eq(
            sourceItemEnrichment.pageContentHash,
            generation.pageContentHash ?? "",
          ),
        ),
      );
    if (!enrichment) return null;
    return {
      kind: "rss",
      content: enrichment.extract,
      limited: false,
      pageContentHash: enrichment.pageContentHash,
      sourceItemEnrichmentId: generation.sourceItemEnrichmentId,
      sourceItemRevisionId: origin.revisionId,
    };
  }
  if (!generation.limited) return null;
  return {
    kind: "rss",
    content: sourceText(origin),
    limited: true,
    pageContentHash: null,
    sourceItemEnrichmentId: null,
    sourceItemRevisionId: origin.revisionId,
  };
}

async function lockCopyGeneration(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
) {
  const [generation] = await tx
    .select()
    .from(copyGeneration)
    .where(
      and(
        inWorkspace(copyGeneration, workspaceId),
        eq(copyGeneration.operationId, operationId),
      ),
    )
    .for("update");
  return generation;
}

type SourceOrigin =
  | {
      kind: "rss";
      articleFetchMode: ArticleFetchMode;
      canonicalUrl: string;
      contentHash: string;
      endpoint: string;
      revisionId: string;
      summary: string | null;
      title: string;
    }
  | {
      kind: "telegram";
      contentHash: string;
      revisionId: string;
      summary: string | null;
      title: string;
    }
  | {
      kind: "promo";
      angle: string;
      description: string;
      promoIdeaId: string;
      title: string;
    };

async function loadCopyOrigin(
  executor: Executor,
  workspaceId: string,
  platformDraftId: string,
): Promise<SourceOrigin | null> {
  const [draft] = await executor
    .select({
      editorialSelectionId: platformDraft.editorialSelectionId,
      telegramFilterResultId: platformDraft.telegramFilterResultId,
      promoIdeaId: platformDraft.promoIdeaId,
    })
    .from(platformDraft)
    .where(
      and(
        inWorkspace(platformDraft, workspaceId),
        eq(platformDraft.id, platformDraftId),
        isNull(platformDraft.deletedAt),
      ),
    );
  if (!draft) return null;

  if (draft.promoIdeaId !== null) {
    const [row] = await executor
      .select({
        promoIdeaId: promoIdea.id,
        title: promoIdea.title,
        description: promoIdea.description,
        angle: promoIdea.angle,
      })
      .from(promoIdea)
      .where(
        and(
          inWorkspace(promoIdea, workspaceId),
          eq(promoIdea.id, draft.promoIdeaId),
        ),
      );
    return row ? { kind: "promo", ...row } : null;
  }

  const authority =
    draft.editorialSelectionId !== null
      ? await loadEditorialSource(
          executor,
          workspaceId,
          draft.editorialSelectionId,
        )
      : draft.telegramFilterResultId !== null
        ? await loadTelegramSource(
            executor,
            workspaceId,
            draft.telegramFilterResultId,
          )
        : null;
  if (!authority) return null;

  if (authority.origin === "telegram_public") {
    return authority.fromTelegramLane
      ? {
          kind: "telegram",
          contentHash: authority.contentHash,
          revisionId: authority.revisionId,
          summary: authority.summary,
          title: authority.title,
        }
      : null;
  }
  if (authority.fromTelegramLane || authority.articleFetchMode === null) {
    return null;
  }
  return {
    kind: "rss",
    articleFetchMode: authority.articleFetchMode,
    canonicalUrl: authority.canonicalUrl,
    contentHash: authority.contentHash,
    endpoint: authority.endpoint,
    revisionId: authority.revisionId,
    summary: authority.summary,
    title: authority.title,
  };
}

async function loadEditorialSource(
  executor: Executor,
  workspaceId: string,
  selectionId: string,
) {
  const [row] = await executor
    .select({
      origin: sourceItem.origin,
      revisionId: sourceItemRevision.id,
      title: sourceItemRevision.title,
      summary: sourceItemRevision.summary,
      canonicalUrl: sourceItemRevision.canonicalUrl,
      contentHash: sourceItemRevision.contentHash,
      endpoint: source.endpoint,
      articleFetchMode: source.articleFetchMode,
    })
    .from(editorialSelection)
    .innerJoin(
      analysisModelUnit,
      and(
        inWorkspace(analysisModelUnit, workspaceId),
        eq(analysisModelUnit.id, editorialSelection.analysisModelUnitId),
      ),
    )
    .innerJoin(
      analysisRunItem,
      and(
        inWorkspace(analysisRunItem, workspaceId),
        eq(analysisRunItem.analysisRunId, analysisModelUnit.analysisRunId),
        eq(analysisRunItem.sourceItemId, editorialSelection.sourceItemId),
      ),
    )
    .innerJoin(
      sourceItemRevision,
      eq(sourceItemRevision.id, analysisRunItem.sourceItemRevisionId),
    )
    .innerJoin(sourceItem, eq(sourceItem.id, editorialSelection.sourceItemId))
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(
        inWorkspace(editorialSelection, workspaceId),
        eq(editorialSelection.id, selectionId),
      ),
    );
  return row ? { ...row, fromTelegramLane: false as const } : null;
}

async function loadTelegramSource(
  executor: Executor,
  workspaceId: string,
  telegramFilterResultId: string,
) {
  const [row] = await executor
    .select({
      origin: sourceItem.origin,
      revisionId: sourceItemRevision.id,
      title: sourceItemRevision.title,
      summary: sourceItemRevision.summary,
      canonicalUrl: sourceItemRevision.canonicalUrl,
      contentHash: sourceItemRevision.contentHash,
      endpoint: source.endpoint,
      articleFetchMode: source.articleFetchMode,
    })
    .from(filterResult)
    .innerJoin(
      analysisRunItem,
      and(
        inWorkspace(analysisRunItem, workspaceId),
        eq(analysisRunItem.analysisRunId, filterResult.analysisRunId),
        eq(analysisRunItem.sourceItemId, filterResult.sourceItemId),
      ),
    )
    .innerJoin(
      sourceItemRevision,
      eq(sourceItemRevision.id, analysisRunItem.sourceItemRevisionId),
    )
    .innerJoin(sourceItem, eq(sourceItem.id, filterResult.sourceItemId))
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(
        inWorkspace(filterResult, workspaceId),
        eq(filterResult.id, telegramFilterResultId),
        eq(filterResult.disposition, "telegram_lane"),
      ),
    );
  return row ? { ...row, fromTelegramLane: true as const } : null;
}

function sourceText(
  origin: Extract<SourceOrigin, { kind: "rss" | "telegram" }>,
) {
  if (origin.kind === "telegram") {
    return (origin.summary ?? origin.title).trim();
  }
  return [origin.title, origin.summary ?? ""]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function boundResult(
  kind: CopySourceKind,
  limited: boolean,
  pageFetch: CopySourceBindingResult["pageFetch"],
  hasInput: boolean,
): CopySourceBindingResult {
  return {
    kind,
    limited,
    pageFetch,
    status: hasInput ? "bound" : "no_input",
  };
}

async function bindSourceRevision(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
  sourceItemRevisionId: string,
  limited: { limited: boolean; limitedReason: EnrichmentReason | null },
) {
  const [bound] = await tx
    .update(copyGeneration)
    .set({
      sourceItemRevisionId,
      limited: limited.limited,
      limitedReason: limited.limitedReason,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(copyGeneration, workspaceId),
        eq(copyGeneration.operationId, operationId),
        isNull(copyGeneration.sourceItemRevisionId),
      ),
    )
    .returning({ operationId: copyGeneration.operationId });
  if (!bound) throw new Error("copy source provenance was already bound");
}

async function bindPageEnrichment(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
  sourceItemRevisionId: string,
  enrichment: { id: string; pageContentHash: string },
) {
  const [bound] = await tx
    .update(copyGeneration)
    .set({
      sourceItemRevisionId,
      sourceItemEnrichmentId: enrichment.id,
      pageContentHash: enrichment.pageContentHash,
      limited: false,
      limitedReason: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(copyGeneration, workspaceId),
        eq(copyGeneration.operationId, operationId),
        isNull(copyGeneration.sourceItemRevisionId),
      ),
    )
    .returning({ operationId: copyGeneration.operationId });
  if (!bound) throw new Error("copy source provenance was already bound");
}

const NONTERMINAL_UNIT_STATUSES = ["pending", "running"] as const;

export type CopyExecutionContext = {
  analysisRunId: string;
  brandPolicyFingerprint: string;
  brandKey: string;
  configurationVersion: string;
  customerTemplateFingerprint: string;
  limited: boolean;
  modelOptionKey: string;
  operationId: string;
  operationLifecycle: OperationLifecycle;
  operationVersion: number;
  platform: Platform;
  platformDraftId: string;
  promptVersion: string;
  requestedContentLocale: ContentLocale;
};

export type CopyExecutionUnit = {
  id: string;
  operationAttemptId: string | null;
  status: "cancelled" | "failed" | "pending" | "running" | "succeeded";
  variantKey: string;
};

export async function findCopyExecutionContext(
  executor: Executor,
  workspaceId: string,
  operationId: string,
): Promise<(CopyExecutionContext & { units: CopyExecutionUnit[] }) | null> {
  const [row] = await executor
    .select({
      analysisRunId: sql<string>`coalesce(${filterResult.analysisRunId}, ${analysisRun.id})`,
      brandPolicyFingerprint: copyGeneration.brandPolicyFingerprint,
      brandKey: mediaBrand.key,
      configurationVersion: copyGeneration.configurationVersion,
      customerTemplateFingerprint: copyGeneration.customerTemplateFingerprint,
      limited: copyGeneration.limited,
      modelOptionKey: copyGeneration.modelOptionKey,
      operationId: copyGeneration.operationId,
      operationLifecycle: operation.lifecycle,
      operationVersion: operation.version,
      platform: platformDraft.platform,
      platformDraftId: platformDraft.id,
      promptVersion: copyGeneration.promptVersion,
      requestedContentLocale: copyGeneration.requestedContentLocale,
    })
    .from(copyGeneration)
    .innerJoin(operation, eq(operation.id, copyGeneration.operationId))
    .innerJoin(
      platformDraft,
      eq(platformDraft.id, copyGeneration.platformDraftId),
    )
    .innerJoin(mediaBrand, eq(mediaBrand.id, platformDraft.mediaBrandId))
    .leftJoin(
      filterResult,
      eq(filterResult.id, platformDraft.telegramFilterResultId),
    )
    .leftJoin(
      editorialSelection,
      eq(editorialSelection.id, platformDraft.editorialSelectionId),
    )
    .leftJoin(promoIdea, eq(promoIdea.id, platformDraft.promoIdeaId))
    .leftJoin(
      analysisModelUnit,
      or(
        eq(analysisModelUnit.id, editorialSelection.analysisModelUnitId),
        eq(analysisModelUnit.id, promoIdea.analysisModelUnitId),
      ),
    )
    .leftJoin(analysisRun, eq(analysisRun.id, analysisModelUnit.analysisRunId))
    .where(
      and(
        inWorkspace(copyGeneration, workspaceId),
        eq(copyGeneration.operationId, operationId),
      ),
    );

  if (!row?.analysisRunId) return null;
  const units = await executor
    .select({
      id: copyGenerationUnit.id,
      operationAttemptId: copyGenerationUnit.operationAttemptId,
      status: copyGenerationUnit.status,
      variantKey: copyGenerationUnit.variantKey,
    })
    .from(copyGenerationUnit)
    .where(
      and(
        inWorkspace(copyGenerationUnit, workspaceId),
        eq(copyGenerationUnit.copyGenerationId, operationId),
      ),
    )
    .orderBy(asc(copyGenerationUnit.createdAt), asc(copyGenerationUnit.id));

  return { ...row, units };
}

export async function claimCopyGeneration(
  executor: Executor,
  workspaceId: string,
  input: {
    claimedBy: string;
    leaseExpiresAt: Date;
    now: Date;
    operationId: string;
  },
) {
  const [generation] = await executor
    .select({ operationId: copyGeneration.operationId })
    .from(copyGeneration)
    .where(
      and(
        inWorkspace(copyGeneration, workspaceId),
        eq(copyGeneration.operationId, input.operationId),
      ),
    );
  if (!generation) return { status: "not_found" as const };

  const claimed = await claimOperationExecution(executor, workspaceId, {
    claimedBy: input.claimedBy,
    id: input.operationId,
    leaseExpiresAt: input.leaseExpiresAt,
    now: input.now,
  });
  if (claimed.status === "terminal") {
    return {
      lifecycle: claimed.operation.lifecycle,
      status: "settled" as const,
    };
  }
  return claimed;
}

export type CopyGenerationClaimFence = {
  claimedBy: string;
  expectedVersion: number;
  now?: Date;
};

async function lockCopyOperation(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
) {
  const [current] = await tx
    .select({
      claimedBy: operation.claimedBy,
      leaseExpiresAt: operation.leaseExpiresAt,
      lifecycle: operation.lifecycle,
      version: operation.version,
    })
    .from(operation)
    .innerJoin(copyGeneration, eq(copyGeneration.operationId, operation.id))
    .where(
      and(inWorkspace(operation, workspaceId), eq(operation.id, operationId)),
    )
    .for("update");
  return current ?? null;
}

function ownsCopyOperationClaim(
  current: NonNullable<Awaited<ReturnType<typeof lockCopyOperation>>>,
  fence: CopyGenerationClaimFence,
) {
  const now = fence.now ?? new Date();
  return (
    current.lifecycle === "running" &&
    current.claimedBy === fence.claimedBy &&
    current.version === fence.expectedVersion &&
    current.leaseExpiresAt !== null &&
    current.leaseExpiresAt > now
  );
}

export async function claimCopyGenerationUnit(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  unitId: string,
  claimFence: CopyGenerationClaimFence,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const parent = await lockCopyOperation(tx, workspaceId, operationId);
    if (!parent) return null;
    if (!ownsCopyOperationClaim(parent, claimFence)) {
      return {
        status:
          parent.lifecycle === "cancelled"
            ? ("cancelled" as const)
            : ("failed" as const),
      };
    }
    const [unit] = await tx
      .select({
        id: copyGenerationUnit.id,
        operationAttemptId: copyGenerationUnit.operationAttemptId,
        status: copyGenerationUnit.status,
        variantKey: copyGenerationUnit.variantKey,
      })
      .from(copyGenerationUnit)
      .where(
        and(
          inWorkspace(copyGenerationUnit, workspaceId),
          eq(copyGenerationUnit.id, unitId),
          eq(copyGenerationUnit.copyGenerationId, operationId),
        ),
      )
      .for("update");
    if (!unit) return null;
    if (unit.status !== "pending") return unit;

    const attempt = await allocateOperationAttemptInTransaction(
      tx,
      workspaceId,
      operationId,
    );
    if (!attempt) return null;
    const [started] = await tx
      .update(copyGenerationUnit)
      .set({ status: "running", operationAttemptId: attempt.id })
      .where(
        and(
          inWorkspace(copyGenerationUnit, workspaceId),
          eq(copyGenerationUnit.id, unitId),
          eq(copyGenerationUnit.status, "pending"),
        ),
      )
      .returning({
        id: copyGenerationUnit.id,
        operationAttemptId: copyGenerationUnit.operationAttemptId,
        status: copyGenerationUnit.status,
        variantKey: copyGenerationUnit.variantKey,
      });
    if (!started) throw new Error("copy unit claim lost under row lock");
    return started;
  });
}

export async function findCopyUnitUsageSlots(
  executor: Executor,
  workspaceId: string,
  operationAttemptId: string,
): Promise<{ invocationKey: InvocationKey; status: UsageStatus }[]> {
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
    )
    .orderBy(asc(aiUsageEvent.occurredAt), asc(aiUsageEvent.id));
}

export type PersistCopyVariantInput = {
  body: string;
  contentLocale: ContentLocale;
  hasMoreSlots: boolean;
  hashtags: string[];
  headline: string;
  operationAttemptId: string;
  operationId: string;
  policyAccepted: boolean;
  claimFence: CopyGenerationClaimFence;
  unitId: string;
};

export async function persistCopyVariantResult(
  tx: Transaction,
  workspaceId: string,
  input: PersistCopyVariantInput,
) {
  await withWorkspaceContext(tx, workspaceId);
  const parent = await lockCopyOperation(tx, workspaceId, input.operationId);
  if (!parent || !ownsCopyOperationClaim(parent, input.claimFence)) {
    return { status: "parent_invalidated" as const };
  }
  const [unit] = await tx
    .select({ status: copyGenerationUnit.status })
    .from(copyGenerationUnit)
    .where(
      and(
        inWorkspace(copyGenerationUnit, workspaceId),
        eq(copyGenerationUnit.id, input.unitId),
        eq(copyGenerationUnit.copyGenerationId, input.operationId),
        eq(copyGenerationUnit.operationAttemptId, input.operationAttemptId),
      ),
    )
    .for("update");
  if (unit?.status !== "running") return { status: "ignored" as const };

  if (input.policyAccepted) {
    await tx.insert(copyVariant).values({
      workspaceId,
      copyGenerationUnitId: input.unitId,
      contentLocale: input.contentLocale,
      headline: input.headline,
      body: input.body,
      hashtags: input.hashtags,
    });
    await tx
      .update(copyGenerationUnit)
      .set({ status: "succeeded" })
      .where(
        and(
          inWorkspace(copyGenerationUnit, workspaceId),
          eq(copyGenerationUnit.id, input.unitId),
        ),
      );
    await settleOperationAttempt(tx, workspaceId, {
      id: input.operationAttemptId,
      outcome: "succeeded",
    });
    await enqueueCopyWake(tx, workspaceId, input.operationId);
    return { status: "persisted" as const };
  }

  if (!input.hasMoreSlots) {
    await tx
      .update(copyGenerationUnit)
      .set({ status: "failed" })
      .where(
        and(
          inWorkspace(copyGenerationUnit, workspaceId),
          eq(copyGenerationUnit.id, input.unitId),
        ),
      );
    await settleOperationAttempt(tx, workspaceId, {
      id: input.operationAttemptId,
      outcome: "failed_terminal",
      failureCode: "VALIDATION_FAILED",
    });
    await enqueueCopyWake(tx, workspaceId, input.operationId);
    return { status: "persisted" as const };
  }
  return { status: "ignored" as const };
}

export async function persistCopyStructuredFailure(
  tx: Transaction,
  workspaceId: string,
  input: {
    code: ErrorCode;
    hasMoreSlots: boolean;
    operationAttemptId: string;
    operationId: string;
    claimFence: CopyGenerationClaimFence;
    unitId: string;
  },
) {
  await withWorkspaceContext(tx, workspaceId);
  if (input.hasMoreSlots) return;
  const parent = await lockCopyOperation(tx, workspaceId, input.operationId);
  if (!parent || !ownsCopyOperationClaim(parent, input.claimFence)) return;
  const [settled] = await tx
    .update(copyGenerationUnit)
    .set({ status: "failed" })
    .where(
      and(
        inWorkspace(copyGenerationUnit, workspaceId),
        eq(copyGenerationUnit.id, input.unitId),
        eq(copyGenerationUnit.operationAttemptId, input.operationAttemptId),
        eq(copyGenerationUnit.status, "running"),
      ),
    )
    .returning({ id: copyGenerationUnit.id });
  if (!settled) return;
  await settleOperationAttempt(tx, workspaceId, {
    id: input.operationAttemptId,
    outcome: "failed_terminal",
    failureCode: input.code,
  });
  await enqueueCopyWake(tx, workspaceId, input.operationId);
}

export async function settleCopyGenerationUnit(
  executor: Executor,
  workspaceId: string,
  input: {
    failureCode: ErrorCode | null;
    operationAttemptId: string;
    operationId: string;
    outcome: "ambiguous" | "failed_terminal";
    status: "cancelled" | "failed";
    unitId: string;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [settled] = await tx
      .update(copyGenerationUnit)
      .set({ status: input.status })
      .where(
        and(
          inWorkspace(copyGenerationUnit, workspaceId),
          eq(copyGenerationUnit.id, input.unitId),
          eq(copyGenerationUnit.operationAttemptId, input.operationAttemptId),
          inArray(copyGenerationUnit.status, NONTERMINAL_UNIT_STATUSES),
        ),
      )
      .returning({ id: copyGenerationUnit.id });
    if (!settled) return false;
    await settleOperationAttempt(tx, workspaceId, {
      id: input.operationAttemptId,
      outcome: input.outcome,
      failureCode: input.failureCode,
    });
    await enqueueCopyWake(tx, workspaceId, input.operationId);
    return true;
  });
}

export async function copyGenerationHasRunningUnit(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const [row] = await executor
    .select({ id: copyGenerationUnit.id })
    .from(copyGenerationUnit)
    .where(
      and(
        inWorkspace(copyGenerationUnit, workspaceId),
        eq(copyGenerationUnit.copyGenerationId, operationId),
        eq(copyGenerationUnit.status, "running"),
      ),
    )
    .limit(1);
  return row !== undefined;
}

function staleCopyOperation(now: Date) {
  return and(
    eq(operation.lifecycle, "running"),
    or(isNull(operation.leaseExpiresAt), lte(operation.leaseExpiresAt, now)),
  );
}

export async function listStaleCopyOperations(
  executor: Executor,
  workspaceId: string,
  input: { limit: number; now: Date },
) {
  return executor
    .select({
      operationId: copyGeneration.operationId,
      operationVersion: operation.version,
    })
    .from(copyGeneration)
    .innerJoin(operation, eq(operation.id, copyGeneration.operationId))
    .where(
      and(
        inWorkspace(copyGeneration, workspaceId),
        staleCopyOperation(input.now),
      ),
    )
    .orderBy(asc(operation.createdAt), asc(operation.id))
    .limit(input.limit);
}

export async function settleStaleCopyOperation(
  executor: Executor,
  workspaceId: string,
  input: { expectedVersion: number; now: Date; operationId: string },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [current] = await tx
      .select({ version: operation.version })
      .from(operation)
      .innerJoin(copyGeneration, eq(copyGeneration.operationId, operation.id))
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.version, input.expectedVersion),
          staleCopyOperation(input.now),
        ),
      )
      .for("update");
    if (!current) return null;

    const openUnits = await tx
      .select({
        id: copyGenerationUnit.id,
        operationAttemptId: copyGenerationUnit.operationAttemptId,
        status: copyGenerationUnit.status,
      })
      .from(copyGenerationUnit)
      .where(
        and(
          inWorkspace(copyGenerationUnit, workspaceId),
          eq(copyGenerationUnit.copyGenerationId, input.operationId),
          inArray(copyGenerationUnit.status, ["pending", "running"]),
        ),
      )
      .for("update");
    for (const unit of openUnits) {
      const attemptId =
        unit.operationAttemptId ??
        (
          await allocateOperationAttemptInTransaction(
            tx,
            workspaceId,
            input.operationId,
          )
        )?.id;
      if (!attemptId) throw new Error("copy stale attempt allocation failed");
      await tx
        .update(copyGenerationUnit)
        .set({
          operationAttemptId: attemptId,
          status: "failed",
          updatedAt: input.now,
        })
        .where(
          and(
            inWorkspace(copyGenerationUnit, workspaceId),
            eq(copyGenerationUnit.id, unit.id),
            eq(copyGenerationUnit.status, unit.status),
          ),
        );
      await settleOperationAttempt(tx, workspaceId, {
        id: attemptId,
        outcome: "failed_terminal",
        failureCode: "INTERNAL_SERVER_ERROR",
      });
    }

    const openAttempts = await tx
      .select({ id: operationAttempt.id })
      .from(operationAttempt)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.operationId, input.operationId),
          isNull(operationAttempt.outcome),
        ),
      )
      .for("update");
    for (const attempt of openAttempts) {
      await settleOperationAttempt(tx, workspaceId, {
        id: attempt.id,
        outcome: "failed_terminal",
        failureCode: "INTERNAL_SERVER_ERROR",
      });
    }

    const [settled] = await tx
      .update(operation)
      .set({
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lifecycle: "failed",
        updatedAt: input.now,
        version: current.version + 1,
      })
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.version, current.version),
          eq(operation.lifecycle, "running"),
        ),
      )
      .returning({
        lifecycle: operation.lifecycle,
        version: operation.version,
      });
    return settled ?? null;
  });
}

export async function failUnstartedCopyGenerationUnits(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    await tx
      .select({ id: operation.id })
      .from(operation)
      .where(
        and(inWorkspace(operation, workspaceId), eq(operation.id, operationId)),
      )
      .for("update");
    const pending = await tx
      .select({ id: copyGenerationUnit.id })
      .from(copyGenerationUnit)
      .where(
        and(
          inWorkspace(copyGenerationUnit, workspaceId),
          eq(copyGenerationUnit.copyGenerationId, operationId),
          eq(copyGenerationUnit.status, "pending"),
        ),
      )
      .for("update");
    for (const unit of pending) {
      const attempt = await allocateOperationAttemptInTransaction(
        tx,
        workspaceId,
        operationId,
      );
      if (!attempt) throw new Error("copy failure attempt allocation failed");
      await tx
        .update(copyGenerationUnit)
        .set({
          operationAttemptId: attempt.id,
          status: "failed",
        })
        .where(
          and(
            inWorkspace(copyGenerationUnit, workspaceId),
            eq(copyGenerationUnit.id, unit.id),
          ),
        );
      await settleOperationAttempt(tx, workspaceId, {
        id: attempt.id,
        outcome: "failed_terminal",
        failureCode: "INTERNAL_SERVER_ERROR",
      });
    }
    return pending.length;
  });
}

export async function settleCopyGeneration(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  forcedFailure = false,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [current] = await tx
      .select({ lifecycle: operation.lifecycle, version: operation.version })
      .from(operation)
      .innerJoin(copyGeneration, eq(copyGeneration.operationId, operation.id))
      .where(
        and(inWorkspace(operation, workspaceId), eq(operation.id, operationId)),
      )
      .for("update");
    if (!current) return null;
    if (
      ["succeeded", "failed", "cancelled", "unknown"].includes(
        current.lifecycle,
      )
    ) {
      return current;
    }

    const units = await tx
      .select({
        status: copyGenerationUnit.status,
        outcome: operationAttempt.outcome,
      })
      .from(copyGenerationUnit)
      .leftJoin(
        operationAttempt,
        eq(operationAttempt.id, copyGenerationUnit.operationAttemptId),
      )
      .where(
        and(
          inWorkspace(copyGenerationUnit, workspaceId),
          eq(copyGenerationUnit.copyGenerationId, operationId),
        ),
      );
    if (
      units.some(
        (unit) => unit.status === "pending" || unit.status === "running",
      )
    ) {
      return { ...current, waiting: true as const };
    }

    const lifecycle: OperationLifecycle = forcedFailure
      ? "failed"
      : units.some((unit) => unit.outcome === "ambiguous")
        ? "unknown"
        : units.some((unit) => unit.status === "succeeded")
          ? "succeeded"
          : units.every((unit) => unit.status === "cancelled")
            ? "cancelled"
            : "failed";
    const [settled] = await tx
      .update(operation)
      .set({
        lifecycle,
        version: current.version + 1,
        claimedBy: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, operationId),
          eq(operation.version, current.version),
        ),
      )
      .returning({
        lifecycle: operation.lifecycle,
        version: operation.version,
      });
    return settled ?? null;
  });
}

export async function markCopyGenerationCancelled(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const current = await lockCopyOperation(tx, workspaceId, operationId);
    if (!current) return null;
    if (["queued", "running"].includes(current.lifecycle)) {
      await tx
        .update(operation)
        .set({
          claimedAt: null,
          claimedBy: null,
          leaseExpiresAt: null,
          lifecycle: "cancelled",
          version: current.version + 1,
        })
        .where(
          and(
            inWorkspace(operation, workspaceId),
            eq(operation.id, operationId),
            eq(operation.version, current.version),
          ),
        );
    }
    const cancelled = await tx
      .update(copyGenerationUnit)
      .set({ status: "cancelled" })
      .where(
        and(
          inWorkspace(copyGenerationUnit, workspaceId),
          eq(copyGenerationUnit.copyGenerationId, operationId),
          inArray(copyGenerationUnit.status, NONTERMINAL_UNIT_STATUSES),
        ),
      )
      .returning({ operationAttemptId: copyGenerationUnit.operationAttemptId });
    for (const unit of cancelled) {
      if (!unit.operationAttemptId) continue;
      await settleOperationAttempt(tx, workspaceId, {
        id: unit.operationAttemptId,
        outcome: "failed_terminal",
      });
    }
    return true;
  });
}

async function enqueueCopyWake(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
) {
  await tx
    .select({ id: operation.id })
    .from(operation)
    .where(
      and(inWorkspace(operation, workspaceId), eq(operation.id, operationId)),
    )
    .for("update");

  const [pending] = await tx
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(
      and(
        inWorkspace(outboxEvent, workspaceId),
        eq(outboxEvent.operationId, operationId),
        eq(
          outboxEvent.eventType,
          OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME,
        ),
        isNull(outboxEvent.dispatchedAt),
        isNull(outboxEvent.exhaustedAt),
      ),
    )
    .limit(1);
  if (pending) return;

  await tx.insert(outboxEvent).values({
    workspaceId,
    operationId,
    eventType: OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME,
    schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
    payload: {
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      workspaceId,
      operationId,
    },
  });
}
