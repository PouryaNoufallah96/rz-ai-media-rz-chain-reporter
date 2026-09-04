import {
  cardOriginReferenceSchema,
  contentLocaleSchema,
  draftRevisionMaterialSchema,
  filteringReasonSchema,
  marketVerifiedFactsSchema,
  modelUnitStatusSchema,
  operationLifecycleSchema,
  operatorImageDirectionSchema,
  platformSchema,
  publicationLifecycleSchema,
  publishCheckpointKindSchema,
  runCardOriginReferenceSchema,
  scheduleStatusSchema,
  settlementActivityStatusSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

import {
  presentationTranslationStatusSchema,
  translationCommandResultSchema,
  translationStatusSchema,
} from "./workspace";

const platformDraftGenerationSchema = z.strictObject({
  operationId: z.uuid(),
  lifecycle: operationLifecycleSchema,
  modelOptionKey: z.string(),
  requestedContentLocale: contentLocaleSchema,
  limited: z.boolean(),
  forceArticleRefresh: z.boolean(),
  createdAt: z.date(),
  units: z.array(
    z.strictObject({
      id: z.uuid(),
      variantKey: z.string(),
      status: modelUnitStatusSchema,
    }),
  ),
});

const copyVariantProjectionSchema = z.strictObject({
  id: z.uuid(),
  operationId: z.uuid(),
  variantKey: z.string(),
  contentLocale: contentLocaleSchema,
  headline: z.string(),
  body: z.string(),
  hashtags: z.array(z.string()),
  limited: z.boolean(),
  modelOptionKey: z.string(),
  createdAt: z.date(),
  translation: translationStatusSchema.nullable(),
});

const imageGenerationProjectionSchema = z.strictObject({
  operationId: z.uuid(),
  draftRevisionId: z.uuid(),
  lifecycle: operationLifecycleSchema,
  modelOptionKey: z.string(),
  referenceMediaAssetId: z.uuid().nullable(),
  providerOriginalMediaAssetId: z.uuid().nullable(),
  finalMediaAssetId: z.uuid().nullable(),
  createdAt: z.date(),
});

export type CopyVariantProjection = z.infer<typeof copyVariantProjectionSchema>;

const draftRevisionProjectionSchema = z.strictObject({
  id: z.uuid(),
  revisionNumber: z.int().positive(),
  contentLocale: contentLocaleSchema,
  headline: z.string(),
  body: z.string(),
  hashtags: z.array(z.string()),
  originatingCopyVariantId: z.uuid(),
  selectedFinalMediaAssetId: z.uuid().nullable(),
  imageIntentVersion: z.int().nonnegative(),
  hasNonterminalImageGeneration: z.boolean(),
  imageProvenanceMismatch: z.boolean(),
  mediaLocked: z.boolean(),
  authoredBy: z.string(),
  authorName: z.string(),
  createdAt: z.date(),
});

export type DraftRevisionProjection = z.infer<
  typeof draftRevisionProjectionSchema
>;

const platformDraftOriginDetailsSchema = z.strictObject({
  sourceName: z.string().nullable(),
  publishedAt: z.date().nullable(),
  canonicalUrl: z.string().nullable(),
  summary: z.string().nullable(),
  contentLocale: contentLocaleSchema.nullable(),
  suitabilityScore: z.int().nullable(),
  reasoning: z.string().nullable(),
  suggestedPlatform: platformSchema.nullable(),
  telegramReason: filteringReasonSchema.nullable(),
  promoAngle: z.string().nullable(),
});

export const platformDraftCardSchema = z.strictObject({
  id: z.uuid(),
  mediaBrandId: z.uuid(),
  brandKey: z.string(),
  brandName: z.string(),
  platform: platformSchema,
  lanePosition: z.int().positive(),
  version: z.int().positive(),
  activeRevisionId: z.uuid().nullable(),
  revisionVersion: z.int().nonnegative(),
  projectionVersion: z.int().nonnegative(),
  nextRevisionNumber: z.int().positive(),
  origin: runCardOriginReferenceSchema,
  originTitle: z.string(),
  presentationReady: z.boolean(),
  presentationTranslation: presentationTranslationStatusSchema.nullable(),
  sourceKind: z.enum(["promo", "rss", "telegram"]),
  originDetails: platformDraftOriginDetailsSchema.nullable(),
  generation: platformDraftGenerationSchema.nullable(),
  candidates: z.array(copyVariantProjectionSchema),
  revisions: z.array(
    draftRevisionProjectionSchema.extend({
      imageSourceReadiness: z.enum(["ready", "extract_required"]),
      sourceAttribution: z.string().nullable(),
      sourceCanonicalUrl: z.string().nullable(),
    }),
  ),
  imageGeneration: imageGenerationProjectionSchema.nullable(),
  publishing: z.strictObject({
    savedCard: z
      .strictObject({
        id: z.uuid(),
        version: z.int().positive(),
        savedAt: z.date(),
        discardedAt: z.date().nullable(),
      })
      .nullable(),
    approval: z
      .strictObject({
        id: z.uuid(),
        draftRevisionId: z.uuid(),
        selectedFinalMediaAssetId: z.uuid().nullable(),
        approvedAt: z.date(),
      })
      .nullable(),
    destinations: z.array(
      z.strictObject({
        id: z.uuid(),
        key: z.string(),
        label: z.string(),
        platform: platformSchema,
        enabled: z.boolean(),
        bound: z.boolean(),
        bindingCheckedAt: z.date().nullable(),
      }),
    ),
    timeZone: z.string(),
    control: z.strictObject({
      paused: z.boolean(),
      environmentForced: z.boolean(),
      version: z.int().nonnegative(),
    }),
    latestPublication: z
      .strictObject({
        id: z.uuid(),
        lifecycle: publicationLifecycleSchema,
        version: z.int().positive(),
        activeOperationId: z.uuid().nullable(),
        destinationAccountId: z.uuid().nullable(),
        unresolvedAttemptId: z.uuid().nullable(),
        confirmedProviderResultId: z.string().nullable(),
        checkpointId: z.uuid().nullable(),
        checkpointKind: publishCheckpointKindSchema.nullable(),
        checkpointReferenceId: z.string().nullable(),
        confirmedAt: z.date().nullable(),
        activityStatus: settlementActivityStatusSchema,
      })
      .nullable(),
    latestSchedule: z
      .strictObject({
        id: z.uuid(),
        lifecycle: scheduleStatusSchema,
        scheduledAt: z.date(),
        timezone: z.string(),
        destinationAccountId: z.uuid(),
        version: z.int().positive(),
      })
      .nullable(),
  }),
});

export type PlatformDraftCard = z.infer<typeof platformDraftCardSchema>;

export const platformDraftExactCardSchema = platformDraftCardSchema.extend({
  lanePosition: z.int().positive().nullable(),
  executionScope: z
    .strictObject({
      kind: z.literal("analysis_run"),
      analysisRunId: z.uuid(),
    })
    .or(
      z.strictObject({
        kind: z.literal("market_analysis"),
        marketAnalysisId: z.uuid(),
      }),
    ),
  origin: cardOriginReferenceSchema,
  sourceKind: z.enum(["market", "promo", "rss", "telegram"]),
  originDetails: platformDraftOriginDetailsSchema
    .extend({
      marketAnalysisId: z.uuid().nullable(),
      verifiedFacts: marketVerifiedFactsSchema.nullable(),
    })
    .nullable(),
});

export type PlatformDraftExactCard = z.infer<
  typeof platformDraftExactCardSchema
>;

export const platformDraftLaneSchema = z.strictObject({
  mediaBrandId: z.uuid(),
  brandKey: z.string(),
  brandName: z.string(),
  platform: platformSchema,
  drafts: z.array(platformDraftCardSchema),
});

export type PlatformDraftLane = z.infer<typeof platformDraftLaneSchema>;

export const platformDraftLanesSchema = z.array(platformDraftLaneSchema);

export const routePlatformDraftInputSchema = z.strictObject({
  origin: runCardOriginReferenceSchema,
  platform: platformSchema,
  modelOptionKey: z.string().trim().min(1, { error: "MODEL_REQUIRED" }),
  requestedContentLocale: contentLocaleSchema,
  idempotencyKey: z.uuid({ error: "IDEMPOTENCY_KEY_REQUIRED" }),
});

export type RoutePlatformDraftInput = z.infer<
  typeof routePlatformDraftInputSchema
>;

export const routePlatformDraftResultSchema = z.strictObject({
  status: z.enum(["created", "replayed", "reconciled"]),
  draftId: z.uuid(),
  platform: platformSchema,
  lanePosition: z.int().positive(),
  generationLifecycle: operationLifecycleSchema.nullable(),
});

export type RoutePlatformDraftResult = z.infer<
  typeof routePlatformDraftResultSchema
>;

export const reorderPlatformDraftsInputSchema = z.strictObject({
  platformDraftId: z.uuid(),
  orderedDrafts: z
    .array(
      z.strictObject({
        id: z.uuid(),
        expectedVersion: z.int().positive(),
      }),
    )
    .min(1, { error: "DRAFT_ORDER_REQUIRED" })
    .max(100, { error: "DRAFT_ORDER_TOO_LARGE" }),
});

export type ReorderPlatformDraftsInput = z.infer<
  typeof reorderPlatformDraftsInputSchema
>;

export const reorderPlatformDraftsResultSchema = z.strictObject({
  drafts: z.array(
    z.strictObject({
      id: z.uuid(),
      lanePosition: z.int().positive(),
      version: z.int().positive(),
    }),
  ),
});

export type ReorderPlatformDraftsResult = z.infer<
  typeof reorderPlatformDraftsResultSchema
>;

const expectedActiveRevisionSchema = z.strictObject({
  id: z.uuid().nullable(),
  version: z.int().nonnegative(),
});

const copyOperationBase = {
  platformDraftId: z.uuid(),
  idempotencyKey: z.uuid({ error: "IDEMPOTENCY_KEY_REQUIRED" }),
};

const configuredCopyOperationBase = {
  ...copyOperationBase,
  modelOptionKey: z.string().trim().min(1, { error: "MODEL_REQUIRED" }),
  requestedContentLocale: contentLocaleSchema,
};

export const regenerateCopyInputSchema = z.strictObject({
  kind: z.literal("regenerate"),
  ...configuredCopyOperationBase,
});

export const refreshArticleAndRegenerateInputSchema = z.strictObject({
  kind: z.literal("refresh_article"),
  ...configuredCopyOperationBase,
});

export const retryCopyGenerationInputSchema = z.strictObject({
  kind: z.literal("retry_failed"),
  ...copyOperationBase,
  requestedContentLocale: contentLocaleSchema,
});

export const copyOperationInputSchema = z.discriminatedUnion("kind", [
  regenerateCopyInputSchema,
  refreshArticleAndRegenerateInputSchema,
  retryCopyGenerationInputSchema,
]);

export type CopyOperationInput = z.infer<typeof copyOperationInputSchema>;

export const copyOperationResultSchema = z.strictObject({
  status: z.enum(["created", "replayed"]),
  operationId: z.uuid(),
  lifecycle: operationLifecycleSchema,
});

export const startCopyVariantTranslationInputSchema = z.strictObject({
  copyVariantId: z.uuid(),
  contentLocale: contentLocaleSchema,
  idempotencyKey: z.uuid({ error: "IDEMPOTENCY_KEY_REQUIRED" }),
});

export const copyVariantTranslationCommandResultSchema =
  translationCommandResultSchema;

const imageGenerationCommandBase = {
  draftRevisionId: z.uuid(),
  expectedRevisionVersion: z.int().nonnegative(),
  expectedImageIntentVersion: z.int().nonnegative(),
  idempotencyKey: z.uuid({ error: "IDEMPOTENCY_KEY_REQUIRED" }),
  modelOptionKey: z.string().trim().min(1, { error: "MODEL_REQUIRED" }),
  operatorDirection: operatorImageDirectionSchema.optional(),
  referenceMediaAssetId: z.uuid().optional(),
};

export const startImageGenerationInputSchema = z.strictObject({
  kind: z.literal("start"),
  ...imageGenerationCommandBase,
});

export const retryImageGenerationInputSchema = z.strictObject({
  kind: z.literal("retry"),
  ...imageGenerationCommandBase,
});

export const imageGenerationCommandResultSchema = z.strictObject({
  status: z.enum(["created", "replayed"]),
  operationId: z.uuid(),
  lifecycle: operationLifecycleSchema,
});

const revisionCommandBase = {
  platformDraftId: z.uuid(),
  idempotencyKey: z.uuid({ error: "IDEMPOTENCY_KEY_REQUIRED" }),
  expectedActive: expectedActiveRevisionSchema,
  presentationLocale: contentLocaleSchema,
};

export const draftEditorSchema = draftRevisionMaterialSchema.omit({
  selectedFinalMediaAssetId: true,
});

const draftRevisionSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("copy_variant"),
    id: z.uuid(),
    contentLocale: contentLocaleSchema,
  }),
  z.strictObject({ kind: z.literal("draft_revision"), id: z.uuid() }),
]);

export const updateDraftRevisionInputSchema = z.discriminatedUnion(
  "commandKind",
  [
    z.strictObject({
      commandKind: z.literal("submit_content"),
      ...revisionCommandBase,
      source: draftRevisionSourceSchema,
      content: draftEditorSchema,
    }),
    z.strictObject({
      commandKind: z.literal("select_revision"),
      ...revisionCommandBase,
      draftRevisionId: z.uuid(),
    }),
    z.strictObject({
      commandKind: z.literal("adopt_image"),
      ...revisionCommandBase,
      finalMediaAssetId: z.uuid(),
      expectedImageIntentVersion: z.int().nonnegative(),
    }),
    z.strictObject({
      commandKind: z.literal("remove_image"),
      ...revisionCommandBase,
      expectedImageIntentVersion: z.int().nonnegative(),
    }),
  ],
);

export type UpdateDraftRevisionInput = z.input<
  typeof updateDraftRevisionInputSchema
>;

export const updateDraftRevisionResultSchema = z.strictObject({
  status: z.enum(["appended", "no_op", "replayed", "selected", "updated"]),
  appendedRevision: z.boolean(),
  revision: z.strictObject({
    id: z.uuid(),
    revisionNumber: z.int().positive(),
  }),
  card: platformDraftExactCardSchema,
});

export type DraftEditorInput = Extract<
  UpdateDraftRevisionInput,
  { commandKind: "submit_content" }
>["content"];
