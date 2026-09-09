import {
  analysisRunWindowHoursSchema,
  contentLocaleSchema,
  MODEL_VENDORS,
  marketOutputFormatSchema,
  marketPeriodSchema,
  marketScaleSchema,
  platformSchema,
  runConfigurationTransportSchema,
  SOURCE_ORIGINS,
  TELEGRAM_ORDERING_MODES,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

import { createMarketAnalysisInputSchema } from "@/features/market-analysis/schemas/create";
import { assistantMarketLoadProjectionSchema } from "@/features/market-analysis/schemas/reads";

export const ASSISTANT_APPROVAL_CONTRACT = "assistant-approval/1" as const;
export const START_RUN_TOOL = "start_run" as const;
export const MARKET_ACTION_TOOL = "market_action" as const;

export const assistantRunQuestionSchema = z.enum([
  "kind",
  "promoBrands",
  "sources",
  "promoText",
  "topics",
]);

export const assistantRunSourceModeSchema = z.enum([
  "owner_defaults",
  "all_enabled",
  "rss_enabled",
  "telegram_enabled",
]);

export const assistantRunIntentPatchSchema = z.strictObject({
  kind: z.enum(["news", "promo"]).optional(),
  brandKeys: z.array(z.string().min(1).max(128)).max(64).optional(),
  modelKeys: z.array(z.string().min(1).max(128)).max(8).optional(),
  platforms: z.array(platformSchema).max(3).optional(),
  sourceMode: assistantRunSourceModeSchema.optional(),
  windowHours: analysisRunWindowHoursSchema.optional(),
  enrichmentEnabled: z.boolean().optional(),
  telegramOnly: z.boolean().optional(),
  orderingMode: z.enum(TELEGRAM_ORDERING_MODES).optional(),
  topN: z.int().positive().optional(),
  topics: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  promoText: z.string().trim().min(1).max(4_000).optional(),
  reusePrevious: z.boolean().optional(),
  useDefaults: z.boolean().optional(),
});

export const assistantRunIntentSchema = assistantRunIntentPatchSchema.extend({
  sourceIds: z.array(z.uuid()).max(200).optional(),
  promoPrompts: z.record(z.string(), z.string()).optional(),
});

export const assistantPendingRunSchema = z.strictObject({
  intent: assistantRunIntentSchema,
  question: assistantRunQuestionSchema.nullable(),
});

const assistantCanonicalRunConfigurationSchema =
  runConfigurationTransportSchema.transform((configuration, context) => {
    if (configuration.kind === "promo") {
      const platforms = configuration.platforms;
      if (!platforms) {
        context.addIssue({
          code: "custom",
          message: "NO_PLATFORM",
          path: ["platforms"],
        });
        return z.NEVER;
      }
      return { ...configuration, platforms };
    }
    return configuration;
  });

export const assistantRunToolInputSchema = assistantRunIntentPatchSchema;

export const sdkApprovalSchema = z.strictObject({
  approvalId: z.string().min(1).max(128),
  signature: z.string().min(1).max(512),
  toolCallId: z.string().min(1).max(128),
});

export const approvalPayloadSchema = z.strictObject({
  actorId: z.string().min(1).max(128),
  configuration: assistantCanonicalRunConfigurationSchema,
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  consequenceKey: z.literal("assistant.run.start"),
  contract: z.literal(ASSISTANT_APPROVAL_CONTRACT),
  expiresAt: z.number().int().positive(),
  idempotencyKey: z.uuid(),
  issuedAt: z.number().int().positive(),
  proposalId: z.uuid(),
  sdkApproval: sdkApprovalSchema,
  templateFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  toolInput: assistantRunToolInputSchema,
  toolName: z.literal(START_RUN_TOOL),
  workspaceId: z.uuid(),
});

export const signedApprovalEnvelopeSchema = z.strictObject({
  payload: approvalPayloadSchema,
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});

const marketSelectionPatchSchema = {
  primaryInstrumentIds: z.array(z.uuid()).min(1).max(3).optional(),
  brandingInstrumentId: z.uuid().optional(),
  comparisonCatalogIdentities: z
    .array(z.string().trim().min(1).max(80))
    .max(3)
    .optional()
    .describe(
      "Send [] when the operator explicitly requests no Binance comparisons. Omit this field only when the operator did not state a comparison choice.",
    ),
  period: marketPeriodSchema.optional(),
  scale: marketScaleSchema.optional(),
  outputFormat: marketOutputFormatSchema.optional(),
  contentLocale: contentLocaleSchema.optional(),
};

const marketReferencePatchSchema = {
  ...marketSelectionPatchSchema,
  primaryInstrumentRefs: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(3)
    .optional(),
};

export const assistantMarketActionNameSchema = z.literal("create");

export const assistantMarketActionInputSchema = z.strictObject({
  action: assistantMarketActionNameSchema,
  ...marketSelectionPatchSchema,
});

export const assistantMarketToolInputSchema = z
  .strictObject({
    action: assistantMarketActionNameSchema,
    ...marketReferencePatchSchema,
  })
  .refine(
    (input) => !(input.primaryInstrumentRefs && input.primaryInstrumentIds),
    { message: "PRIMARY_INSTRUMENT_SELECTOR_CONFLICT" },
  );

export const assistantMarketValuesSchema = z.strictObject({
  brandingInstrumentId: z.uuid().optional(),
  comparisonCatalogIdentities: z
    .array(z.string().trim().min(1).max(80))
    .max(3)
    .optional(),
  contentLocale: contentLocaleSchema.optional(),
  outputFormat: marketOutputFormatSchema.optional(),
  period: marketPeriodSchema.optional(),
  primaryInstrumentIds: z.array(z.uuid()).min(1).max(3).optional(),
  scale: marketScaleSchema.optional(),
});

export const assistantMarketQuestionSchema = z.enum([
  "primaryInstrumentIds",
  "comparisonCatalogIdentities",
  "period",
  "scale",
  "outputFormat",
  "contentLocale",
]);

export const assistantPendingMarketSchema = z.strictObject({
  intent: assistantMarketToolInputSchema,
  question: assistantMarketQuestionSchema.nullable(),
  values: assistantMarketValuesSchema,
});

export const assistantMarketCommandSchema = z.strictObject({
  action: assistantMarketActionNameSchema,
  input: createMarketAnalysisInputSchema,
});

export const marketApprovalPayloadSchema = z.strictObject({
  actorId: z.string().min(1).max(128),
  command: assistantMarketCommandSchema,
  consequenceKey: z.literal("assistant.market.create"),
  contract: z.literal(ASSISTANT_APPROVAL_CONTRACT),
  expiresAt: z.number().int().positive(),
  issuedAt: z.number().int().positive(),
  materialHash: z.string().regex(/^[a-f0-9]{64}$/),
  proposalId: z.uuid(),
  sdkApproval: sdkApprovalSchema,
  templateFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  toolInput: assistantMarketToolInputSchema,
  toolName: z.literal(MARKET_ACTION_TOOL),
  values: assistantMarketValuesSchema,
  workspaceId: z.uuid(),
});

export const signedMarketApprovalEnvelopeSchema = z.strictObject({
  payload: marketApprovalPayloadSchema,
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});

export const assistantMarketLoadResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.literal("disabled") }),
    assistantMarketLoadProjectionSchema.extend({
      status: z.literal("loaded"),
      resolvedToolInput: assistantMarketActionInputSchema.nullable(),
      question: assistantMarketQuestionSchema.nullable(),
    }),
  ],
);

export const assistantPrepareMarketResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("prepared"),
      envelope: signedMarketApprovalEnvelopeSchema,
    }),
    z.strictObject({
      status: z.enum(["disabled", "invalid", "not_ready", "template_drift"]),
    }),
  ],
);

export const assistantMarketResultSchema = z.strictObject({
  status: z.enum(["completed", "queued", "replayed"]),
  action: assistantMarketActionNameSchema,
  analysisId: z.uuid(),
  href: z.string().startsWith("/"),
  operationId: z.uuid().nullable(),
  version: z.int().positive(),
});

export const assistantApproveMarketResponseSchema = z.discriminatedUnion(
  "status",
  [
    assistantMarketResultSchema,
    z.strictObject({
      status: z.enum([
        "disabled",
        "expired",
        "invalid",
        "not_ready",
        "stale",
        "template_drift",
      ]),
    }),
  ],
);

export const assistantApprovalRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("load-run-form") }),
  z.strictObject({
    action: z.literal("prepare-run"),
    configuration: runConfigurationTransportSchema,
    sdkApproval: sdkApprovalSchema,
    toolInput: assistantRunToolInputSchema,
  }),
  z.strictObject({
    action: z.literal("approve-run"),
    envelope: signedApprovalEnvelopeSchema,
  }),
  z.strictObject({
    action: z.literal("load-market"),
    locale: contentLocaleSchema,
    toolInput: assistantMarketToolInputSchema,
  }),
  z.strictObject({
    action: z.literal("prepare-market"),
    locale: contentLocaleSchema,
    sdkApproval: sdkApprovalSchema,
    toolInput: assistantMarketToolInputSchema,
    values: assistantMarketValuesSchema,
  }),
  z.strictObject({
    action: z.literal("approve-market"),
    envelope: signedMarketApprovalEnvelopeSchema,
    locale: contentLocaleSchema,
  }),
]);

const runFormOptionsSchema = z.strictObject({
  models: z.array(
    z.strictObject({
      key: z.string(),
      name: z.string(),
      vendor: z.enum(MODEL_VENDORS).nullable(),
    }),
  ),
  brands: z.array(
    z.strictObject({
      key: z.string(),
      name: z.string(),
      logo: z
        .strictObject({
          url: z.string(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .nullable(),
      promoEnabled: z.boolean(),
    }),
  ),
  platforms: z.array(platformSchema),
  defaults: z.strictObject({
    brands: z.array(z.string()),
    models: z.array(z.string()),
    platforms: z.array(platformSchema),
    windowHours: analysisRunWindowHoursSchema,
    enrichment: z.boolean(),
    sourceKeys: z.array(z.string()).optional(),
    orderingMode: z.enum(TELEGRAM_ORDERING_MODES),
    topN: z.int().positive(),
  }),
  bounds: z.strictObject({
    brandKeys: z.array(z.string()),
    modelKeys: z.array(z.string()),
    platforms: z.array(platformSchema),
    selectionCap: z.int().positive(),
    shortlistCap: z.int().positive(),
    promoPromptMaxChars: z.int().positive(),
    semanticMaxChars: z.int().positive(),
    semanticMaxTopics: z.int().nonnegative(),
    fanOutMaxUnits: z.int().positive(),
  }),
  windowHours: z.array(analysisRunWindowHoursSchema),
  recentTopics: z.array(z.string()),
  previousRun: z
    .strictObject({
      id: z.uuid(),
      dropped: z.array(z.string()),
      configuration: assistantCanonicalRunConfigurationSchema,
    })
    .nullable(),
});

export const assistantRunFormLoadResponseSchema = z.strictObject({
  status: z.literal("loaded"),
  options: runFormOptionsSchema,
  sources: z.array(
    z.strictObject({
      id: z.uuid(),
      key: z.string(),
      name: z.string(),
      origin: z.enum(SOURCE_ORIGINS),
      lifecycle: z.enum(["enabled", "disabled", "retired"]),
    }),
  ),
});

export const assistantPrepareRunResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("prepared"),
      envelope: signedApprovalEnvelopeSchema,
    }),
    z.strictObject({ status: z.literal("invalid") }),
    z.strictObject({ status: z.literal("invalid_configuration") }),
    z.strictObject({ status: z.literal("template_drift") }),
  ],
);

export const assistantApproveRunResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.enum(["created", "replayed"]),
      analysisRunId: z.uuid(),
      operationId: z.uuid(),
      href: z.string().startsWith("/"),
    }),
    z.strictObject({
      status: z.enum(["expired", "invalid", "stale", "template_drift"]),
    }),
  ],
);

export type ApprovalPayload = z.infer<typeof approvalPayloadSchema>;
export type AssistantApprovalRequest = z.infer<
  typeof assistantApprovalRequestSchema
>;
export type SignedApprovalEnvelope = z.infer<
  typeof signedApprovalEnvelopeSchema
>;
export type SignedMarketApprovalEnvelope = z.infer<
  typeof signedMarketApprovalEnvelopeSchema
>;
export type AssistantMarketActionInput = z.infer<
  typeof assistantMarketActionInputSchema
>;
export type AssistantMarketToolInput = z.infer<
  typeof assistantMarketToolInputSchema
>;
export type AssistantMarketValues = z.infer<typeof assistantMarketValuesSchema>;
export type AssistantPendingMarket = z.infer<
  typeof assistantPendingMarketSchema
>;
export type AssistantMarketQuestion = z.infer<
  typeof assistantMarketQuestionSchema
>;
export type AssistantMarketCommand = z.infer<
  typeof assistantMarketCommandSchema
>;
export type AssistantMarketLoadResponse = z.infer<
  typeof assistantMarketLoadResponseSchema
>;
export type AssistantMarketResult = z.infer<typeof assistantMarketResultSchema>;
export type AssistantRunIntent = z.infer<typeof assistantRunIntentSchema>;
export type AssistantRunIntentPatch = z.infer<
  typeof assistantRunIntentPatchSchema
>;
export type AssistantPendingRun = z.infer<typeof assistantPendingRunSchema>;
export type AssistantRunQuestion = z.infer<typeof assistantRunQuestionSchema>;
export type AssistantRunFormLoadResponse = z.infer<
  typeof assistantRunFormLoadResponseSchema
>;
export type AssistantRunResult = Extract<
  z.infer<typeof assistantApproveRunResponseSchema>,
  { status: "created" | "replayed" }
>;
