import {
  modelBackendSchema,
  type Platform,
  sourceOriginSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

import { stableKeySchema } from "./stable-key";

// Loader compatibility only. Git owns content versioning, so this bumps solely
// when a template that loaded before would no longer load.
export const CUSTOMER_TEMPLATE_SCHEMA_VERSION = 1;

const trimmedText = z
  .string()
  .min(1)
  .refine(
    (value) => value.trim() === value,
    "Expected no surrounding whitespace",
  );

const mediaBrandSchema = z.strictObject({
  key: stableKeySchema,
  name: trimmedText,
});

export const MODEL_TASK_KEYS = ["generation-probe"] as const;

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

const sourceSchema = z.strictObject({
  key: stableKeySchema,
  origin: sourceOriginSchema,
  endpoint: trimmedText,
  name: trimmedText,
  enabled: z.boolean(),
  metadata: z.record(z.string(), trimmedText).optional(),
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
    }),
    workspace: z.strictObject({ name: trimmedText }),
    mediaBrands: z.array(mediaBrandSchema).min(1),
    sources: z.array(sourceSchema),
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
