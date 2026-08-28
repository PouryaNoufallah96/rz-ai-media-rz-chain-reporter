import {
  analysisRunWindowHoursSchema,
  articleFetchModeSchema,
  contentLocaleSchema,
  MAX_EMBEDDING_VALUES,
  modelBackendSchema,
  type Platform,
  platformSchema,
  type SourceOrigin,
  telegramOrderingModeSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

import { stableKeySchema } from "./stable-key";

export type { ImageProfile } from "./image-profile";
export { imageProfileSchema } from "./image-profile";

// Loader compatibility only. Git owns content versioning, so this normally bumps
// solely when a template that loaded before would no longer load; owner lock Q25
// bumped it to 7 for optional Reviewed Knowledge even though v6 templates still parse.
export const CUSTOMER_TEMPLATE_SCHEMA_VERSION = 7;

const trimmedText = z
  .string()
  .min(1)
  .refine(
    (value) => value.trim() === value,
    "Expected no surrounding whitespace",
  );

// A capability check, not an allowlist: `supportedValuesOf` enumerates canonical
// identifiers and rejects accepted aliases such as `UTC`, `GMT` and `Etc/UTC`.
const ianaTimeZoneSchema = trimmedText.refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Expected an IANA time zone");

// Relative path only; the loader realpath-guards the rest.
const referencePathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.[A-Za-z0-9]+$/,
    "Expected a relative path inside the customer directory",
  );

const score = z.number().min(0).max(100);
const relevanceThreshold = z.number().min(1).max(100);
const weight = z.number().min(0).max(1);
const positiveTermWeight = z.number().positive().max(100);
const negativeTermWeight = z.number().min(-100).negative();

const positiveWeightedTermSchema = z.strictObject({
  term: trimmedText,
  weight: positiveTermWeight,
});

const negativeWeightedTermSchema = z.strictObject({
  term: trimmedText,
  weight: negativeTermWeight,
});

const aliasSchema = z.strictObject({
  canonical: trimmedText,
  surfaces: z.array(trimmedText).min(1),
});

export const VALUE_SIGNAL_KINDS = [
  "number",
  "percentage",
  "currency_amount",
  "magnitude_amount",
] as const;

export type ValueSignalKind = (typeof VALUE_SIGNAL_KINDS)[number];

const brandEditorialSchema = z.strictObject({
  mediaFitThreshold: score,
  strongTerms: z.array(positiveWeightedTermSchema),
  weakTerms: z.array(negativeWeightedTermSchema),
  aliases: z.array(aliasSchema),
  phrases: z.array(
    z.strictObject({ phrase: trimmedText, weight: positiveTermWeight }),
  ),
  preferredSourceKeys: z.array(stableKeySchema),
  semanticAnchors: z.array(trimmedText),
  promoEnabled: z.boolean(),
  canonicalHashtags: z.strictObject({
    en: trimmedText.regex(/^#[^\s#]+$/, "Expected one canonical hashtag"),
    fa: trimmedText.regex(/^#[^\s#]+$/, "Expected one canonical hashtag"),
  }),
  valueGate: z
    .strictObject({
      signalKinds: z.array(z.enum(VALUE_SIGNAL_KINDS)),
      forecastTerms: z.array(trimmedText),
    })
    .optional(),
});

const brandLogoSchema = z.strictObject({
  path: referencePathSchema,
  mimeType: z.literal("image/png"),
  pixelWidth: z.int().positive(),
  pixelHeight: z.int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, "Expected a SHA-256 digest"),
});

const mediaBrandSchema = z.strictObject({
  key: stableKeySchema,
  name: trimmedText,
  brandBible: referencePathSchema.optional(),
  imageProfile: referencePathSchema.optional(),
  brandLogo: brandLogoSchema.optional(),
  editorial: brandEditorialSchema,
});

export const MODEL_TASK_KEYS = [
  "assistant-synthesis",
  "generation-probe",
  "keyword-embedding",
  "enrichment-brief",
  "image-template-selection",
  "image-creative-brief",
] as const;

export const EDITORIAL_SELECTION_TASK_PREFIX = "editorial-selection:";
export const PROMO_IDEAS_TASK_PREFIX = "promo-ideas:";
export const COPY_GENERATION_TASK_PREFIX = "copy-generation:";
export const IMAGE_GENERATION_TASK_PREFIX = "image-generation:";

export const modelTaskKeySchema = z.union([
  z.enum(MODEL_TASK_KEYS),
  z.templateLiteral([EDITORIAL_SELECTION_TASK_PREFIX, z.string()]),
  z.templateLiteral([PROMO_IDEAS_TASK_PREFIX, z.string()]),
  z.templateLiteral([COPY_GENERATION_TASK_PREFIX, z.string()]),
  z.templateLiteral([IMAGE_GENERATION_TASK_PREFIX, z.string()]),
]);

export type ModelTaskKey = z.infer<typeof modelTaskKeySchema>;

const modelRouteSchema = z.strictObject({
  backend: modelBackendSchema,
  model: trimmedText,
});

const modelTaskSchema = modelRouteSchema.extend({
  fallback: modelRouteSchema.optional(),
});

const modelsSchema = z.strictObject({
  tasks: z.partialRecord(modelTaskKeySchema, modelTaskSchema),
});

// UI locale, not source content locale: Reviewed Knowledge answers follow the
// operator's interface language and are never mixed or translated.
export const REVIEWED_KNOWLEDGE_LOCALES = ["en", "fa"] as const;

export type ReviewedKnowledgeLocale =
  (typeof REVIEWED_KNOWLEDGE_LOCALES)[number];

const reviewedKnowledgeLocaleSchema = z.enum(REVIEWED_KNOWLEDGE_LOCALES);

const localizedReferenceSchema = z.partialRecord(
  reviewedKnowledgeLocaleSchema,
  referencePathSchema,
);

const reviewedKnowledgeSchema = z.strictObject({
  faq: localizedReferenceSchema.optional(),
  workspaceOverview: localizedReferenceSchema.optional(),
  brandChat: z
    .partialRecord(stableKeySchema, localizedReferenceSchema)
    .optional(),
});

export const reviewedKnowledgeFaqSchema = z
  .array(
    z.strictObject({
      key: stableKeySchema.or(z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/)),
      question: trimmedText.max(400),
      aliases: z.array(trimmedText.max(400)).max(20),
      keywords: z.array(trimmedText.max(120)).max(40),
      answer: trimmedText.max(4_000),
      priority: z.int().min(0).max(1_000),
      followUpKeys: z.array(trimmedText.max(120)).max(6).optional(),
    }),
  )
  .min(1)
  .max(500);

export type ReviewedKnowledgeFaqRow = z.infer<
  typeof reviewedKnowledgeFaqSchema
>[number];

// Enabled sources must be English; a Persian source is a schema error, not a silent skip.
const ACQUISITION_CONTENT_LOCALES = ["en"] as const;

const sourceBase = {
  key: stableKeySchema,
  name: trimmedText,
  enabled: z.boolean(),
  metadata: z.record(z.string(), trimmedText).optional(),
  contentLocale: contentLocaleSchema,
};

const telegramHandleSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]{4,32}$/, "Expected a public Telegram channel handle");

const telegramDestinationChannelSchema = z
  .string()
  .regex(
    /^(?:@[A-Za-z0-9_]{4,32}|-\d{1,16})$/,
    "Expected @channel_username or a negative Telegram channel chat ID",
  );

const sourceSchema = z.discriminatedUnion("origin", [
  z.strictObject({
    ...sourceBase,
    origin: z.literal("rss" satisfies SourceOrigin),
    endpoint: z.httpUrl(),
    articleFetchMode: articleFetchModeSchema,
  }),
  z.strictObject({
    ...sourceBase,
    origin: z.literal("telegram_public" satisfies SourceOrigin),
    endpoint: telegramHandleSchema,
  }),
]);

type ConfiguredSourceOrigin = z.infer<typeof sourceSchema>["origin"];

type AssertSourceOriginCoverage = [ConfiguredSourceOrigin] extends [
  SourceOrigin,
]
  ? [SourceOrigin] extends [ConfiguredSourceOrigin]
    ? true
    : never
  : never;

const assertSourceOriginCoverage: AssertSourceOriginCoverage = true;
void assertSourceOriginCoverage;

const MAX_TELEGRAM_TOP_N = 20;
const MAX_ENRICHMENT_ITEMS_PER_IMPORT = 200;
const MAX_ITEMS_PER_SOURCE = 100;

const acquisitionSchema = z.strictObject({
  defaultWindowHours: z.int().positive(),
  maxItemsPerSource: z.int().min(1).max(MAX_ITEMS_PER_SOURCE),
  telegram: z.strictObject({
    orderingMode: telegramOrderingModeSchema,
    topN: z.int().min(1).max(MAX_TELEGRAM_TOP_N),
  }),
});

const enrichmentSchema = z.strictObject({
  enabled: z.boolean(),
  maxItemsPerImport: z.int().min(1).max(MAX_ENRICHMENT_ITEMS_PER_IMPORT),
  freshnessHours: z.int().positive(),
});

const boundedRangeSchema = z.strictObject({
  min: z.int().nonnegative(),
  max: z.int().positive(),
});

const variantKeySchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/, "Expected a stable variant key");

const platformDraftingPolicySchema = z.strictObject({
  platform: platformSchema,
  variants: z
    .array(
      z.strictObject({
        key: variantKeySchema,
        instruction: trimmedText,
      }),
    )
    .min(1),
  assembledCharacters: boundedRangeSchema,
  hashtags: boundedRangeSchema,
  emojiGraphemeCap: z.int().nonnegative(),
});

const draftingSchema = z.strictObject({
  copy: z.strictObject({
    fetchMinimumChars: z.int().positive(),
    modelMaxChars: z.int().positive(),
    platforms: z.array(platformDraftingPolicySchema).min(1),
  }),
  image: z.strictObject({
    models: z
      .array(
        z.strictObject({
          key: stableKeySchema,
          name: trimmedText,
          enabled: z.boolean(),
        }),
      )
      .min(1),
    defaultModelKey: stableKeySchema,
  }),
});

const editorialSchema = z.strictObject({
  topicAliases: z.array(aliasSchema),
  models: z
    .array(z.strictObject({ key: stableKeySchema, name: trimmedText }))
    .min(1)
    .max(8),
  platforms: z.array(platformSchema).min(1),
  defaults: z.strictObject({
    brands: z.array(stableKeySchema),
    models: z.array(stableKeySchema),
    platforms: z.array(platformSchema),
    windowHours: analysisRunWindowHoursSchema,
    enrichment: z.boolean(),
    sourceKeys: z.array(stableKeySchema).optional(),
  }),
  shortlistCap: z.int().min(1).max(50),
  selectionCap: z.int().min(1).max(20),
  importReuseMinutes: z.int().min(1).max(1440),
  fanOut: z.strictObject({
    maxUnits: z.int().min(1).max(64),
    unitConcurrency: z.int().min(1).max(16),
  }),
  promo: z.strictObject({
    ideaCount: z.int().min(1).max(10),
    promptMaxChars: z.int().min(1).max(4000),
  }),
  drafting: draftingSchema,
  semantic: z.strictObject({
    maxCandidates: z.int().min(1).max(400),
    maxTopics: z.int().min(1).max(20),
    maxAnchorsPerBrand: z.int().min(1).max(20),
    maxChars: z.int().min(1).max(500),
    dedupThreshold: weight,
    brandWeight: weight,
    topicWeight: weight,
  }),
  policy: z.strictObject({
    weights: z.strictObject({
      withTopics: z.strictObject({
        mediaFit: weight,
        lexicalTopic: weight,
        virality: weight,
        freshness: weight,
        authority: weight,
        sourcePreference: weight,
        diversity: weight,
      }),
      withoutTopics: z.strictObject({
        mediaFit: weight,
        virality: weight,
        freshness: weight,
        authority: weight,
        sourcePreference: weight,
        diversity: weight,
      }),
    }),
    thresholds: z.strictObject({
      policyScore: score,
      lexicalTopicScore: relevanceThreshold,
    }),
    freshnessLadder: z
      .array(z.strictObject({ maxAgeHours: z.int().positive(), score }))
      .min(1, { error: "FRESHNESS_LADDER_EMPTY" }),
    futureDateNeutralScore: score,
    virality: z.strictObject({
      powerTerms: z.array(positiveWeightedTermSchema),
      entityTerms: z.array(positiveWeightedTermSchema),
      titleMultiplier: z.number().nonnegative(),
      bodyMultiplier: z.number().nonnegative(),
      numericSignalWeights: z.strictObject({
        number: positiveTermWeight,
        percentage: positiveTermWeight,
        currencyAmount: positiveTermWeight,
        magnitudeAmount: positiveTermWeight,
      }),
    }),
    unknownSourceAuthority: score,
    sourceAuthority: z.record(stableKeySchema, score),
  }),
});

// Closed set: a platform exists only once its adapter ships.
const destinationAccountSchema = z.discriminatedUnion("platform", [
  z.strictObject({
    key: stableKeySchema,
    platform: z.literal("telegram" satisfies Platform),
    enabled: z.boolean(),
    metadata: z.strictObject({
      label: trimmedText,
      channel: telegramDestinationChannelSchema,
    }),
  }),
  z.strictObject({
    key: stableKeySchema,
    platform: z.literal("x" satisfies Platform),
    enabled: z.boolean(),
    metadata: z.strictObject({ label: trimmedText }),
  }),
  z.strictObject({
    key: stableKeySchema,
    platform: z.literal("instagram" satisfies Platform),
    enabled: z.boolean(),
    // Account path segment for the publishing container flow, not a credential.
    metadata: z.strictObject({
      label: trimmedText,
      professionalAccountId: trimmedText,
      username: trimmedText.optional(),
    }),
  }),
]);

type DestinationAccountPlatform = z.infer<
  typeof destinationAccountSchema
>["platform"];

type AssertPlatformCoverage = [DestinationAccountPlatform] extends [Platform]
  ? [Platform] extends [DestinationAccountPlatform]
    ? true
    : never
  : never;

const assertPlatformCoverage: AssertPlatformCoverage = true;
void assertPlatformCoverage;

const brandDestinationSchema = z.strictObject({
  brandKey: stableKeySchema,
  destinationKey: stableKeySchema,
});

function reportDuplicateKeys(
  ctx: z.RefinementCtx,
  section: string,
  entries: readonly { key: string }[],
) {
  const seen = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.key)) {
      ctx.addIssue({
        code: "custom",
        path: [section, index, "key"],
        message: `Duplicate key "${entry.key}"`,
      });
    }
    seen.add(entry.key);
  }
}

// No defaults or transforms: the fingerprint must cover the authored value, including array order.
const customerTemplateShapeSchema = z.strictObject({
  schemaVersion: z.literal(CUSTOMER_TEMPLATE_SCHEMA_VERSION),
  customer: z.strictObject({
    key: stableKeySchema,
    productName: trimmedText,
    timeZone: ianaTimeZoneSchema,
  }),
  workspace: z.strictObject({ name: trimmedText }),
  mediaBrands: z.array(mediaBrandSchema).min(1),
  sources: z.array(sourceSchema),
  acquisition: acquisitionSchema,
  enrichment: enrichmentSchema,
  editorial: editorialSchema,
  destinationAccounts: z.array(destinationAccountSchema),
  brandDestinations: z.array(brandDestinationSchema),
  models: modelsSchema,
  reviewedKnowledge: reviewedKnowledgeSchema.optional(),
});

export const customerTemplateSchema = customerTemplateShapeSchema.superRefine(
  (template, ctx) => {
    reportDuplicateKeys(ctx, "mediaBrands", template.mediaBrands);
    reportDuplicateKeys(ctx, "sources", template.sources);
    reportDuplicateKeys(
      ctx,
      "destinationAccounts",
      template.destinationAccounts,
    );

    const endpoints = new Set<string>();

    for (const [index, configured] of template.sources.entries()) {
      const endpoint = `${configured.origin}\u0000${configured.endpoint}`;

      if (endpoints.has(endpoint)) {
        ctx.addIssue({
          code: "custom",
          path: ["sources", index, "endpoint"],
          message: "Duplicate source endpoint",
        });
      }

      endpoints.add(endpoint);

      if (
        configured.enabled &&
        !ACQUISITION_CONTENT_LOCALES.some(
          (locale) => locale === configured.contentLocale,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["sources", index, "contentLocale"],
          message: `Acquisition does not support content locale "${configured.contentLocale}"`,
        });
      }
    }

    const brandKeys = new Set(template.mediaBrands.map((brand) => brand.key));
    const destinationKeys = new Set(
      template.destinationAccounts.map((account) => account.key),
    );
    const mapped = new Set<string>();

    for (const [index, brand] of template.mediaBrands.entries()) {
      if (
        (brand.imageProfile === undefined) !==
        (brand.brandLogo === undefined)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["mediaBrands", index, "brandLogo"],
          message: "IMAGE_PROFILE_BRAND_LOGO_PAIR_REQUIRED",
        });
      }
    }

    for (const brandKey of Object.keys(
      template.reviewedKnowledge?.brandChat ?? {},
    )) {
      if (!brandKeys.has(brandKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewedKnowledge", "brandChat", brandKey],
          message: `Unknown media brand "${brandKey}"`,
        });
      }
    }

    for (const [index, mapping] of template.brandDestinations.entries()) {
      if (!brandKeys.has(mapping.brandKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["brandDestinations", index, "brandKey"],
          message: `Unknown media brand "${mapping.brandKey}"`,
        });
      }

      if (!destinationKeys.has(mapping.destinationKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["brandDestinations", index, "destinationKey"],
          message: `Unknown destination account "${mapping.destinationKey}"`,
        });
      }

      const pair = `${mapping.brandKey}\u0000${mapping.destinationKey}`;

      if (mapped.has(pair)) {
        ctx.addIssue({
          code: "custom",
          path: ["brandDestinations", index],
          message: `Duplicate mapping of "${mapping.brandKey}" to "${mapping.destinationKey}"`,
        });
      }

      mapped.add(pair);
    }

    reportEditorialIssues(ctx, template, brandKeys);
  },
);

export type CustomerTemplate = z.infer<typeof customerTemplateSchema>;

function reportEditorialIssues(
  ctx: z.RefinementCtx,
  template: z.infer<typeof customerTemplateShapeSchema>,
  brandKeys: ReadonlySet<string>,
) {
  const { editorial } = template;
  const optionKeys = new Set(editorial.models.map((option) => option.key));
  const imageOptionKeys = new Set(
    editorial.drafting.image.models.map((option) => option.key),
  );
  const sourceKeys = new Set(template.sources.map((source) => source.key));
  const taskKeys = Object.keys(template.models.tasks);

  reportAliasIssues(ctx, editorial.topicAliases, ["editorial", "topicAliases"]);
  reportDuplicateValues(
    ctx,
    editorial.models.map((model, index) => ({
      path: ["editorial", "models", index, "key"],
      value: model.key,
    })),
    "DUPLICATE_EDITORIAL_MODEL",
  );
  reportDuplicateValues(
    ctx,
    editorial.platforms.map((platform, index) => ({
      path: ["editorial", "platforms", index],
      value: platform,
    })),
    "DUPLICATE_EDITORIAL_PLATFORM",
  );
  reportDuplicateValues(
    ctx,
    [
      ...editorial.policy.virality.powerTerms.map((entry, index) => ({
        path: ["editorial", "policy", "virality", "powerTerms", index, "term"],
        value: entry.term,
      })),
      ...editorial.policy.virality.entityTerms.map((entry, index) => ({
        path: ["editorial", "policy", "virality", "entityTerms", index, "term"],
        value: entry.term,
      })),
    ],
    "DUPLICATE_VIRALITY_TERM",
  );

  for (const [index, option] of editorial.models.entries()) {
    const routed = [
      `${EDITORIAL_SELECTION_TASK_PREFIX}${option.key}`,
      `${PROMO_IDEAS_TASK_PREFIX}${option.key}`,
      `${COPY_GENERATION_TASK_PREFIX}${option.key}`,
    ].every((taskKey) => taskKeys.includes(taskKey));

    if (!routed) {
      ctx.addIssue({
        code: "custom",
        path: ["editorial", "models", index, "key"],
        message: "EDITORIAL_MODEL_ROUTE_MISSING",
      });
    }
  }

  const requiredTaskKeys = [
    "keyword-embedding",
    "image-template-selection",
    "image-creative-brief",
    ...(template.enrichment.enabled ? (["enrichment-brief"] as const) : []),
  ] satisfies readonly ModelTaskKey[];

  for (const fixedTaskKey of requiredTaskKeys) {
    if (!taskKeys.includes(fixedTaskKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["models", "tasks", fixedTaskKey],
        message: "IMAGE_TASK_ROUTE_MISSING",
      });
    }
  }

  for (const [index, option] of editorial.drafting.image.models.entries()) {
    const taskKey = `${IMAGE_GENERATION_TASK_PREFIX}${option.key}`;

    if (!taskKeys.includes(taskKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["editorial", "drafting", "image", "models", index, "key"],
        message: "IMAGE_MODEL_ROUTE_MISSING",
      });
    }
  }

  // A prefixed family accepts any suffix, so an orphan route would validate,
  // never be asserted at prestart, and silently do nothing.
  for (const taskKey of taskKeys) {
    for (const prefix of [
      EDITORIAL_SELECTION_TASK_PREFIX,
      PROMO_IDEAS_TASK_PREFIX,
      COPY_GENERATION_TASK_PREFIX,
    ]) {
      if (
        taskKey.startsWith(prefix) &&
        !optionKeys.has(taskKey.slice(prefix.length))
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["models", "tasks", taskKey],
          message: "EDITORIAL_MODEL_ROUTE_ORPHANED",
        });
      }
    }

    if (
      taskKey.startsWith(IMAGE_GENERATION_TASK_PREFIX) &&
      !imageOptionKeys.has(taskKey.slice(IMAGE_GENERATION_TASK_PREFIX.length))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["models", "tasks", taskKey],
        message: "IMAGE_MODEL_ROUTE_ORPHANED",
      });
    }
  }

  reportDraftingIssues(ctx, editorial);

  for (const key of Object.keys(editorial.policy.sourceAuthority)) {
    if (!sourceKeys.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["editorial", "policy", "sourceAuthority", key],
        message: "UNKNOWN_SOURCE_AUTHORITY_KEY",
      });
    }
  }

  reportUnknownDefaults(ctx, editorial, brandKeys, optionKeys, sourceKeys);

  if (editorial.selectionCap > editorial.shortlistCap) {
    ctx.addIssue({
      code: "custom",
      path: ["editorial", "selectionCap"],
      message: "SELECTION_CAP_EXCEEDS_SHORTLIST_CAP",
    });
  }

  for (const [name, weights] of Object.entries(editorial.policy.weights)) {
    const total = Object.values(weights).reduce((sum, part) => sum + part, 0);

    if (Math.abs(total - 1) > 1e-6) {
      ctx.addIssue({
        code: "custom",
        path: ["editorial", "policy", "weights", name],
        message: "WEIGHTS_MUST_SUM_TO_ONE",
      });
    }
  }

  const ladder = editorial.policy.freshnessLadder;

  for (const [index, rung] of ladder.entries()) {
    const previous = ladder[index - 1];

    if (previous !== undefined && rung.maxAgeHours <= previous.maxAgeHours) {
      ctx.addIssue({
        code: "custom",
        path: ["editorial", "policy", "freshnessLadder", index, "maxAgeHours"],
        message: "FRESHNESS_LADDER_NOT_INCREASING",
      });
    }
  }

  const { semantic } = editorial;

  if (semantic.brandWeight + semantic.topicWeight > 1) {
    ctx.addIssue({
      code: "custom",
      path: ["editorial", "semantic", "topicWeight"],
      message: "SEMANTIC_WEIGHTS_EXCEED_ONE",
    });
  }

  const embeddedValues =
    semantic.maxCandidates +
    semantic.maxTopics +
    template.mediaBrands.length * semantic.maxAnchorsPerBrand;

  if (embeddedValues > MAX_EMBEDDING_VALUES) {
    ctx.addIssue({
      code: "custom",
      path: ["editorial", "semantic", "maxCandidates"],
      message: "EMBEDDING_CAPACITY_EXCEEDED",
    });
  }

  for (const [index, brand] of template.mediaBrands.entries()) {
    reportBrandEditorialIssues(
      ctx,
      brand.editorial,
      index,
      semantic,
      sourceKeys,
    );
  }
}

function reportDraftingIssues(
  ctx: z.RefinementCtx,
  editorial: z.infer<typeof editorialSchema>,
) {
  const policyPlatforms = new Set<string>();

  for (const [index, policy] of editorial.drafting.copy.platforms.entries()) {
    if (policyPlatforms.has(policy.platform)) {
      ctx.addIssue({
        code: "custom",
        path: ["editorial", "drafting", "copy", "platforms", index, "platform"],
        message: "DUPLICATE_DRAFTING_PLATFORM",
      });
    }
    policyPlatforms.add(policy.platform);

    const variantKeys = new Set<string>();
    for (const [variantIndex, variant] of policy.variants.entries()) {
      if (variantKeys.has(variant.key)) {
        ctx.addIssue({
          code: "custom",
          path: [
            "editorial",
            "drafting",
            "copy",
            "platforms",
            index,
            "variants",
            variantIndex,
            "key",
          ],
          message: "DUPLICATE_COPY_VARIANT",
        });
      }
      variantKeys.add(variant.key);
    }

    for (const [field, range] of [
      ["assembledCharacters", policy.assembledCharacters],
      ["hashtags", policy.hashtags],
    ] as const) {
      if (range.min > range.max) {
        ctx.addIssue({
          code: "custom",
          path: ["editorial", "drafting", "copy", "platforms", index, field],
          message: "DRAFTING_RANGE_REVERSED",
        });
      }
    }
  }

  for (const [index, platform] of editorial.platforms.entries()) {
    if (!policyPlatforms.has(platform)) {
      ctx.addIssue({
        code: "custom",
        path: ["editorial", "platforms", index],
        message: "DRAFTING_PLATFORM_POLICY_MISSING",
      });
    }
  }

  for (const policy of editorial.drafting.copy.platforms) {
    if (!editorial.platforms.includes(policy.platform)) {
      ctx.addIssue({
        code: "custom",
        path: ["editorial", "drafting", "copy", "platforms"],
        message: "DRAFTING_PLATFORM_POLICY_ORPHANED",
      });
    }
  }

  if (
    editorial.drafting.copy.fetchMinimumChars >
    editorial.drafting.copy.modelMaxChars
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["editorial", "drafting", "copy", "fetchMinimumChars"],
      message: "COPY_FETCH_MINIMUM_EXCEEDS_MODEL_CAP",
    });
  }

  const imageModelKeys = new Set<string>();
  for (const [index, model] of editorial.drafting.image.models.entries()) {
    if (imageModelKeys.has(model.key)) {
      ctx.addIssue({
        code: "custom",
        path: ["editorial", "drafting", "image", "models", index, "key"],
        message: "DUPLICATE_IMAGE_MODEL",
      });
    }
    imageModelKeys.add(model.key);
  }

  const defaultImageModel = editorial.drafting.image.models.find(
    (model) => model.key === editorial.drafting.image.defaultModelKey,
  );

  if (defaultImageModel === undefined || !defaultImageModel.enabled) {
    ctx.addIssue({
      code: "custom",
      path: ["editorial", "drafting", "image", "defaultModelKey"],
      message: "ENABLED_DEFAULT_IMAGE_MODEL_REQUIRED",
    });
  }
}

function reportUnknownDefaults(
  ctx: z.RefinementCtx,
  editorial: z.infer<typeof editorialSchema>,
  brandKeys: ReadonlySet<string>,
  optionKeys: ReadonlySet<string>,
  sourceKeys: ReadonlySet<string>,
) {
  const { defaults } = editorial;
  const platforms = new Set<string>(editorial.platforms);

  for (const [field, values] of [
    ["brands", defaults.brands],
    ["models", defaults.models],
    ["platforms", defaults.platforms],
    ["sourceKeys", defaults.sourceKeys ?? []],
  ] as const) {
    reportDuplicateValues(
      ctx,
      values.map((value, index) => ({
        path: ["editorial", "defaults", field, index],
        value,
      })),
      "DUPLICATE_EDITORIAL_DEFAULT",
    );
  }

  const unknown = [
    ["brands", defaults.brands, brandKeys, "UNKNOWN_DEFAULT_BRAND"],
    ["models", defaults.models, optionKeys, "UNKNOWN_DEFAULT_MODEL"],
    ["platforms", defaults.platforms, platforms, "UNKNOWN_DEFAULT_PLATFORM"],
    [
      "sourceKeys",
      defaults.sourceKeys ?? [],
      sourceKeys,
      "UNKNOWN_DEFAULT_SOURCE_KEY",
    ],
  ] as const;

  for (const [field, selected, allowed, message] of unknown) {
    for (const [index, value] of selected.entries()) {
      if (!allowed.has(value)) {
        ctx.addIssue({
          code: "custom",
          path: ["editorial", "defaults", field, index],
          message,
        });
      }
    }
  }
}

function reportBrandEditorialIssues(
  ctx: z.RefinementCtx,
  brand: z.infer<typeof brandEditorialSchema>,
  index: number,
  semantic: z.infer<typeof editorialSchema>["semantic"],
  sourceKeys: ReadonlySet<string>,
) {
  const at = (...path: (string | number)[]): (string | number)[] => [
    "mediaBrands",
    index,
    "editorial",
    ...path,
  ];

  reportAliasIssues(ctx, brand.aliases, at("aliases"));
  reportDuplicateValues(
    ctx,
    [
      ...brand.strongTerms.map((entry, position) => ({
        path: at("strongTerms", position, "term"),
        value: entry.term,
      })),
      ...brand.weakTerms.map((entry, position) => ({
        path: at("weakTerms", position, "term"),
        value: entry.term,
      })),
      ...brand.phrases.map((entry, position) => ({
        path: at("phrases", position, "phrase"),
        value: entry.phrase,
      })),
    ],
    "DUPLICATE_BRAND_VOCABULARY",
  );
  reportDuplicateValues(
    ctx,
    brand.preferredSourceKeys.map((value, position) => ({
      path: at("preferredSourceKeys", position),
      value,
    })),
    "DUPLICATE_PREFERRED_SOURCE",
  );
  reportDuplicateValues(
    ctx,
    brand.semanticAnchors.map((value, position) => ({
      path: at("semanticAnchors", position),
      value,
    })),
    "DUPLICATE_SEMANTIC_ANCHOR",
  );

  for (const [position, key] of brand.preferredSourceKeys.entries()) {
    if (!sourceKeys.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: at("preferredSourceKeys", position),
        message: "UNKNOWN_PREFERRED_SOURCE_KEY",
      });
    }
  }

  if (brand.semanticAnchors.length > semantic.maxAnchorsPerBrand) {
    ctx.addIssue({
      code: "custom",
      path: at("semanticAnchors"),
      message: "TOO_MANY_SEMANTIC_ANCHORS",
    });
  }

  // Every embedded value rides the same call; one long value fails the stage.
  for (const [position, anchor] of brand.semanticAnchors.entries()) {
    if (anchor.length > semantic.maxChars) {
      ctx.addIssue({
        code: "custom",
        path: at("semanticAnchors", position),
        message: "SEMANTIC_ANCHOR_TOO_LONG",
      });
    }
  }

  // A brand with no anchor has no similarity, and both fallbacks fabricate one.
  if (semantic.brandWeight > 0 && brand.semanticAnchors.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: at("semanticAnchors"),
      message: "BRAND_REQUIRES_SEMANTIC_ANCHOR",
    });
  }

  if (
    brand.valueGate !== undefined &&
    brand.valueGate.signalKinds.length === 0 &&
    brand.valueGate.forecastTerms.length === 0
  ) {
    ctx.addIssue({
      code: "custom",
      path: at("valueGate"),
      message: "VALUE_GATE_EMPTY",
    });
  }

  if (brand.valueGate !== undefined) {
    reportDuplicateValues(
      ctx,
      brand.valueGate.signalKinds.map((value, position) => ({
        path: at("valueGate", "signalKinds", position),
        value,
      })),
      "DUPLICATE_VALUE_SIGNAL_KIND",
    );
    reportDuplicateValues(
      ctx,
      brand.valueGate.forecastTerms.map((value, position) => ({
        path: at("valueGate", "forecastTerms", position),
        value,
      })),
      "DUPLICATE_FORECAST_TERM",
    );
  }
}

function reportDuplicateValues(
  ctx: z.RefinementCtx,
  entries: readonly {
    path: readonly (string | number)[];
    value: string;
  }[],
  message: string,
) {
  const seen = new Set<string>();

  for (const entry of entries) {
    const normalized = normalizeAliasTerm(entry.value);
    if (seen.has(normalized)) {
      ctx.addIssue({ code: "custom", path: [...entry.path], message });
    }
    seen.add(normalized);
  }
}

function reportAliasIssues(
  ctx: z.RefinementCtx,
  aliases: readonly z.infer<typeof aliasSchema>[],
  path: readonly (string | number)[],
) {
  const terms = new Map<string, "canonical" | "surface">();

  for (const [aliasIndex, alias] of aliases.entries()) {
    const canonical = normalizeAliasTerm(alias.canonical);
    const canonicalKind = terms.get(canonical);

    if (canonicalKind !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [...path, aliasIndex, "canonical"],
        message:
          canonicalKind === "canonical"
            ? "DUPLICATE_ALIAS_CANONICAL"
            : "ALIAS_CANONICAL_SURFACE_COLLISION",
      });
    } else {
      terms.set(canonical, "canonical");
    }

    for (const [surfaceIndex, surfaceValue] of alias.surfaces.entries()) {
      const surface = normalizeAliasTerm(surfaceValue);
      const existingKind = terms.get(surface);

      if (existingKind !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [...path, aliasIndex, "surfaces", surfaceIndex],
          message:
            existingKind === "canonical"
              ? "ALIAS_CANONICAL_SURFACE_COLLISION"
              : "DUPLICATE_ALIAS_SURFACE",
        });
      } else {
        terms.set(surface, "surface");
      }
    }
  }
}

function normalizeAliasTerm(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
}
