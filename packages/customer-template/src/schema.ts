import {
  articleFetchModeSchema,
  contentLocaleSchema,
  modelBackendSchema,
  type Platform,
  type SourceOrigin,
  telegramOrderingModeSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

import { stableKeySchema } from "./stable-key";

export type { ImageProfile } from "./image-profile";
export { imageProfileSchema } from "./image-profile";

// Loader compatibility only. Git owns content versioning, so this bumps solely
// when a template that loaded before would no longer load.
export const CUSTOMER_TEMPLATE_SCHEMA_VERSION = 2;

const trimmedText = z
  .string()
  .min(1)
  .refine(
    (value) => value.trim() === value,
    "Expected no surrounding whitespace",
  );

const ianaTimeZoneSchema = trimmedText.refine(
  (value) => Intl.supportedValuesOf("timeZone").includes(value),
  "Expected an IANA time zone",
);

// Relative path only; the loader realpath-guards the rest.
const referencePathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.[A-Za-z0-9]+$/,
    "Expected a relative path inside the customer directory",
  );

const mediaBrandSchema = z.strictObject({
  key: stableKeySchema,
  name: trimmedText,
  brandBible: referencePathSchema.optional(),
  imageProfile: referencePathSchema.optional(),
});

export const MODEL_TASK_KEYS = [
  "generation-probe",
  "keyword-embedding",
  "enrichment-brief",
] as const;

export type ModelTaskKey = (typeof MODEL_TASK_KEYS)[number];

export const modelTaskKeySchema = z.enum(MODEL_TASK_KEYS);

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
export const customerTemplateSchema = z
  .strictObject({
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
    destinationAccounts: z.array(destinationAccountSchema),
    brandDestinations: z.array(brandDestinationSchema),
    models: modelsSchema.optional(),
  })
  .superRefine((template, ctx) => {
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
  });

export type CustomerTemplate = z.infer<typeof customerTemplateSchema>;
