import { z } from "zod";

import { errorCodeSchema } from "./error";
import { invocationKeySchema } from "./operation";
import { platformSchema } from "./platform";
import { contentLocaleSchema } from "./source";

export const COPY_PROMPT_VERSION = "copy-prompt-v2";
export const COPY_CONFIGURATION_VERSION = "copy-configuration-v1";

export const CARD_ORIGIN_KINDS = [
  "editorial_selection",
  "telegram_filter_result",
  "promo_idea",
  "market_analysis_handoff",
] as const;

export type CardOriginKind = (typeof CARD_ORIGIN_KINDS)[number];

const editorialSelectionOriginSchema = z.strictObject({
  kind: z.literal(CARD_ORIGIN_KINDS[0]),
  editorialSelectionId: z.uuid(),
});
const telegramFilterResultOriginSchema = z.strictObject({
  kind: z.literal(CARD_ORIGIN_KINDS[1]),
  telegramFilterResultId: z.uuid(),
});
const promoIdeaOriginSchema = z.strictObject({
  kind: z.literal(CARD_ORIGIN_KINDS[2]),
  promoIdeaId: z.uuid(),
});
const marketAnalysisHandoffOriginSchema = z.strictObject({
  kind: z.literal(CARD_ORIGIN_KINDS[3]),
  marketAnalysisHandoffId: z.uuid(),
});

export const runCardOriginReferenceSchema = z.discriminatedUnion("kind", [
  editorialSelectionOriginSchema,
  telegramFilterResultOriginSchema,
  promoIdeaOriginSchema,
]);

export type RunCardOriginReference = z.infer<
  typeof runCardOriginReferenceSchema
>;

export const cardOriginReferenceSchema = z.discriminatedUnion("kind", [
  editorialSelectionOriginSchema,
  telegramFilterResultOriginSchema,
  promoIdeaOriginSchema,
  marketAnalysisHandoffOriginSchema,
]);

export type CardOriginReference = z.infer<typeof cardOriginReferenceSchema>;

export const prepareMarketPlatformInputSchema = z.strictObject({
  analysisId: z.uuid(),
  platform: platformSchema,
  modelOptionKey: z
    .string()
    .trim()
    .min(1, { error: "MODEL_REQUIRED" })
    .optional(),
  idempotencyKey: z.uuid({ error: "IDEMPOTENCY_KEY_REQUIRED" }),
});

export const prepareMarketPlatformResultSchema = z.strictObject({
  status: z.enum(["created", "replayed", "reconciled"]),
  draftId: z.uuid(),
  platform: platformSchema,
  lanePosition: z.null(),
  generationLifecycle: z
    .enum([
      "queued",
      "running",
      "settling",
      "succeeded",
      "failed",
      "cancelled",
      "unknown",
    ])
    .nullable(),
});

export const PERSISTED_DRAFT_REVISION_COMMAND_KINDS = [
  "apply_copy_variant",
  "submit_content",
  "adopt_image",
  "remove_image",
  "select_revision",
] as const;

export type PersistedDraftRevisionCommandKind =
  (typeof PERSISTED_DRAFT_REVISION_COMMAND_KINDS)[number];

const draftHashtagSchema = z
  .string()
  .trim()
  .min(1, { error: "DRAFT_HASHTAG_REQUIRED" });

export const draftRevisionMaterialSchema = z.strictObject({
  contentLocale: contentLocaleSchema,
  headline: z.string().trim().min(1, { error: "DRAFT_HEADLINE_REQUIRED" }),
  body: z.string().trim().min(1, { error: "DRAFT_BODY_REQUIRED" }),
  hashtags: z
    .array(draftHashtagSchema)
    .min(1, { error: "DRAFT_HASHTAGS_REQUIRED" }),
  selectedFinalMediaAssetId: z.uuid().nullable(),
});

export type DraftRevisionMaterial = z.infer<typeof draftRevisionMaterialSchema>;

export const IMAGE_SOURCE_PROJECTION_KINDS = [
  "rss_extract",
  "rss_feed",
  "telegram_post",
  "promo_idea",
] as const;

export type ImageSourceProjectionKind =
  (typeof IMAGE_SOURCE_PROJECTION_KINDS)[number];

export const templateSelectionSchema = z.strictObject({
  family: z.string().trim().min(1, { error: "IMAGE_FAMILY_REQUIRED" }),
  axes: z.record(z.string(), z.string().nullable()),
});

export type TemplateSelection = z.infer<typeof templateSelectionSchema>;

export const creativeImageBriefSchema = z.strictObject({
  headline: z.string().trim().min(1, { error: "IMAGE_HEADLINE_REQUIRED" }),
  subjectScene: z
    .string()
    .trim()
    .min(1, { error: "IMAGE_SUBJECT_SCENE_REQUIRED" }),
  dataElements: z.array(
    z.strictObject({
      value: z.string(),
      label: z.string(),
    }),
  ),
});

export type CreativeImageBrief = z.infer<typeof creativeImageBriefSchema>;

const selectionRejectionSchema = z.strictObject({
  invocationKey: invocationKeySchema,
  code: errorCodeSchema,
  signature: z.string().optional(),
  matchedGenerationId: z.uuid().optional(),
});

export type SelectionRejection = z.infer<typeof selectionRejectionSchema>;
