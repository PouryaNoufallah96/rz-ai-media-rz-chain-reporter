import {
  cardOriginReferenceSchema,
  contentLocaleSchema,
  modelUnitStatusSchema,
  operationLifecycleSchema,
  operatorImageDirectionSchema,
  platformSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

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
  authoredBy: z.string(),
  authorName: z.string(),
  createdAt: z.date(),
});

export type DraftRevisionProjection = z.infer<
  typeof draftRevisionProjectionSchema
>;

export const platformDraftCardSchema = z.strictObject({
  id: z.uuid(),
  mediaBrandId: z.uuid(),
  brandKey: z.string(),
  brandName: z.string(),
  platform: platformSchema,
  lanePosition: z.int().positive(),
  version: z.int().positive(),
  origin: cardOriginReferenceSchema,
  originTitle: z.string(),
  sourceKind: z.enum(["promo", "rss", "telegram"]),
  generation: platformDraftGenerationSchema.nullable(),
  candidates: z.array(copyVariantProjectionSchema),
  revisions: z.array(
    draftRevisionProjectionSchema.extend({
      imageSourceReadiness: z.enum(["ready", "extract_required"]),
    }),
  ),
  imageGeneration: imageGenerationProjectionSchema.nullable(),
  imageModels: z.array(z.strictObject({ key: z.string(), name: z.string() })),
});

export type PlatformDraftCard = z.infer<typeof platformDraftCardSchema>;

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
  origin: cardOriginReferenceSchema,
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
  expectedVersion: z.int().positive(),
  orderedDraftIds: z
    .array(z.uuid())
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

const expectedLatestRevisionSchema = z
  .strictObject({
    id: z.uuid().nullable(),
    revisionNumber: z.int().positive().nullable(),
  })
  .refine((value) => (value.id === null) === (value.revisionNumber === null), {
    error: "EXPECTED_LATEST_INVALID",
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

const imageGenerationCommandBase = {
  draftRevisionId: z.uuid(),
  expectedRevisionNumber: z.int().positive(),
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
  expectedLatest: expectedLatestRevisionSchema,
};

export const draftEditorSchema = z.strictObject({
  contentLocale: contentLocaleSchema,
  headline: z.string().trim().min(1, { error: "DRAFT_HEADLINE_REQUIRED" }),
  body: z.string().trim().min(1, { error: "DRAFT_BODY_REQUIRED" }),
  hashtags: z.array(z.string()).min(1, { error: "DRAFT_HASHTAGS_REQUIRED" }),
});

export const updateDraftRevisionInputSchema = z.discriminatedUnion(
  "commandKind",
  [
    z.strictObject({
      commandKind: z.literal("apply_copy_variant"),
      ...revisionCommandBase,
      copyVariantId: z.uuid(),
    }),
    z.strictObject({
      commandKind: z.literal("submit_content"),
      ...revisionCommandBase,
      content: draftEditorSchema,
    }),
    z.strictObject({
      commandKind: z.literal("adopt_image"),
      ...revisionCommandBase,
      finalMediaAssetId: z.uuid(),
    }),
    z.strictObject({
      commandKind: z.literal("remove_image"),
      ...revisionCommandBase,
    }),
  ],
);

export type UpdateDraftRevisionInput = z.infer<
  typeof updateDraftRevisionInputSchema
>;

export const updateDraftRevisionResultSchema = z.strictObject({
  status: z.enum(["appended", "no_op", "replayed"]),
  appendedRevision: z.boolean(),
  revision: draftRevisionProjectionSchema.omit({ authorName: true }).extend({
    workspaceId: z.uuid(),
    platformDraftId: z.uuid(),
  }),
});

export type DraftEditorInput = Extract<
  UpdateDraftRevisionInput,
  { commandKind: "submit_content" }
>["content"];
