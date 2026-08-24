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

// Loader compatibility only. Git owns content versioning, so this bumps solely
// when a template that loaded before would no longer load.
export const CUSTOMER_TEMPLATE_SCHEMA_VERSION = 3;

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
const weight = z.number().min(0).max(1);

const weightedTermSchema = z.strictObject({
  term: trimmedText,
  weight: z.number(),
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
  strongTerms: z.array(weightedTermSchema),
  weakTerms: z.array(weightedTermSchema),
  aliases: z.array(
    z.strictObject({
      canonical: trimmedText,
      surfaces: z.array(trimmedText),
    }),
  ),
  phrases: z.array(z.strictObject({ phrase: trimmedText, weight: z.number() })),
  preferredSourceKeys: z.array(stableKeySchema),
  semanticAnchors: z.array(trimmedText),
  promoEnabled: z.boolean(),
  valueGate: z
    .strictObject({
      signalKinds: z.array(z.enum(VALUE_SIGNAL_KINDS)),
      forecastTerms: z.array(trimmedText),
    })
    .optional(),
});

const mediaBrandSchema = z.strictObject({
  key: stableKeySchema,
  name: trimmedText,
  brandBible: referencePathSchema.optional(),
  imageProfile: referencePathSchema.optional(),
  editorial: brandEditorialSchema,
});

export const MODEL_TASK_KEYS = [
  "generation-probe",
  "keyword-embedding",
  "enrichment-brief",
] as const;

export const EDITORIAL_SELECTION_TASK_PREFIX = "editorial-selection:";
export const PROMO_IDEAS_TASK_PREFIX = "promo-ideas:";

export const modelTaskKeySchema = z.union([
  z.enum(MODEL_TASK_KEYS),
  z.templateLiteral([EDITORIAL_SELECTION_TASK_PREFIX, z.string()]),
  z.templateLiteral([PROMO_IDEAS_TASK_PREFIX, z.string()]),
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

const acquisitionSchema = z.strictObject({
  defaultWindowHours: z.int().positive(),
  maxItemsPerSource: z.int().positive(),
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

const editorialSchema = z.strictObject({
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
    }),
    freshnessLadder: z
      .array(z.strictObject({ maxAgeHours: z.int().positive(), score }))
      .min(1, { error: "FRESHNESS_LADDER_EMPTY" }),
    futureDateNeutralScore: score,
    virality: z.strictObject({
      powerTerms: z.array(weightedTermSchema),
      entityTerms: z.array(weightedTermSchema),
      titleMultiplier: z.number().nonnegative(),
      bodyMultiplier: z.number().nonnegative(),
      numericSignalWeights: z.strictObject({
        number: z.number(),
        percentage: z.number(),
        currencyAmount: z.number(),
        magnitudeAmount: z.number(),
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
      channel: trimmedText.optional(),
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
  models: modelsSchema.optional(),
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
  const sourceKeys = new Set(template.sources.map((source) => source.key));
  const taskKeys = Object.keys(template.models?.tasks ?? {});

  for (const [index, option] of editorial.models.entries()) {
    const routed = [
      `${EDITORIAL_SELECTION_TASK_PREFIX}${option.key}`,
      `${PROMO_IDEAS_TASK_PREFIX}${option.key}`,
    ].every((taskKey) => taskKeys.includes(taskKey));

    if (!routed) {
      ctx.addIssue({
        code: "custom",
        path: ["editorial", "models", index, "key"],
        message: "EDITORIAL_MODEL_ROUTE_MISSING",
      });
    }
  }

  // A prefixed family accepts any suffix, so an orphan route would validate,
  // never be asserted at prestart, and silently do nothing.
  for (const taskKey of taskKeys) {
    for (const prefix of [
      EDITORIAL_SELECTION_TASK_PREFIX,
      PROMO_IDEAS_TASK_PREFIX,
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
  }

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

function reportUnknownDefaults(
  ctx: z.RefinementCtx,
  editorial: z.infer<typeof editorialSchema>,
  brandKeys: ReadonlySet<string>,
  optionKeys: ReadonlySet<string>,
  sourceKeys: ReadonlySet<string>,
) {
  const { defaults } = editorial;
  const platforms = new Set<string>(editorial.platforms);

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
}
