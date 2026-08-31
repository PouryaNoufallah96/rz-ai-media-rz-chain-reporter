import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  copyVariantTranslationRequestedPayloadSchema,
  DURABLE_EVENT_SCHEMA_VERSION,
  OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import { asSchema } from "ai";
import { z } from "zod";

import {
  type CopyVariantTranslationBundle,
  copyVariantTranslationOutputSchema,
  copyVariantTranslationPrompt,
} from "../editorial/copy-variant-localization";
import { createInngestClient } from "./client";
import { normalizeCopyCandidate } from "./copy-generation";
import {
  COPY_VARIANT_TRANSLATION_FUNCTION_ID,
  COPY_VARIANT_TRANSLATION_RETRIES,
  createCopyVariantTranslationFunctions,
} from "./copy-variant-translation";
import { createInngestEvent, durableEvents } from "./events";
import { openWorkerRuntime } from "./runtime";

const source = {
  body: "Follow the verified Bitcoin purchase and market context.",
  hashtags: ["#CoinHall", "#Bitcoin", "#MicroStrategy"],
  headline: "MicroStrategy Ends 10-Week Pause With $370 Million Bitcoin Buy",
} satisfies CopyVariantTranslationBundle;

const constraints = {
  canonicalHashtag: "#کوین_هال",
  maximumCharacters: 600,
  maximumHashtags: 5,
  minimumHashtags: 3,
  platform: "telegram" as const,
};

const valid = {
  body: "خرید تاییدشده بیت‌کوین و شرایط بازار را دنبال کنید.",
  hashtags: ["#کوین_هال", "#بیت_کوین", "#مایکرواستراتژی"],
  headline: "مایکرواستراتژی پس از وقفه ۱۰ هفته‌ای، ۳۷۰ میلیون دلار بیت‌کوین خرید",
};

async function proveOutputContract() {
  const schema = copyVariantTranslationOutputSchema(source, "fa", constraints);
  assert.equal(schema.safeParse(valid).success, true);
  assert.equal(schema.safeParse({ ...valid, body: "" }).success, false);
  assert.equal(
    schema.safeParse({ ...valid, headline: source.headline }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ ...valid, hashtags: valid.hashtags.slice(0, 2) })
      .success,
    false,
  );
  assert.equal(
    schema.safeParse({
      ...valid,
      hashtags: ["#Wrong", ...valid.hashtags.slice(1)],
    }).success,
    false,
  );
  assert.equal(schema.safeParse({ ...valid, unexpected: true }).success, false);

  const identitySource = {
    ...source,
    body: "Read https://example.test/report from @MicroStrategy about $MSTR.",
  };
  const identitySchema = copyVariantTranslationOutputSchema(
    identitySource,
    "fa",
    constraints,
  );
  const identityOutput = {
    ...valid,
    body: "گزارش https://example.test/report از @MicroStrategy درباره $MSTR را بخوانید.",
  };
  assert.equal(identitySchema.safeParse(identityOutput).success, true);
  assert.equal(
    identitySchema.safeParse({
      ...identityOutput,
      body: "گزارش حذف‌شده درباره مایکرواستراتژی را بخوانید.",
    }).success,
    false,
  );

  const validPolicy = normalizeForProbe(schema.parse(valid));
  assert.equal(validPolicy.failures.length, 0);
  const mostlySourceLanguage = schema.parse({
    ...valid,
    body: `${source.body} ترجمه`,
    headline: `${source.headline} ترجمه`,
  });
  assert.equal(
    normalizeForProbe(mostlySourceLanguage).failures.includes(
      "CONTENT_LOCALE_MISMATCH",
    ),
    true,
  );

  const long = schema.parse({
    ...valid,
    body: `گزارش ${"بیت‌کوین ".repeat(200)}و شرایط بازار را بررسی می‌کند`,
  });
  const fitted = normalizeForProbe(long);
  assert.equal(fitted.failures.includes("LENGTH_ABOVE_MAX"), false);
  assert.equal(fitted.hashtags.length, source.hashtags.length);

  const requiredUrl = "https://example.test/important";
  const fittedIdentitySource = {
    body: `Read the important report at ${requiredUrl}`,
    hashtags: ["#برند", "#گزارش"],
    headline: "Important report",
  };
  const fittedIdentityConstraints = {
    ...constraints,
    canonicalHashtag: "#برند",
    maximumCharacters: 120,
    minimumHashtags: 2,
  };
  const fittedIdentitySchema = copyVariantTranslationOutputSchema(
    fittedIdentitySource,
    "fa",
    fittedIdentityConstraints,
  );
  const identityBeforeFitting = fittedIdentitySchema.parse({
    body: `${"این ترجمه طولانی است ".repeat(30)}${requiredUrl}`,
    hashtags: fittedIdentitySource.hashtags,
    headline: "گزارش مهم",
  });
  const identityAfterFitting = normalizeCopyCandidate(
    "telegram",
    identityBeforeFitting,
    {
      canonicalHashtag: fittedIdentityConstraints.canonicalHashtag,
      emojiGraphemeCap: 3,
      maximumCharacters: fittedIdentityConstraints.maximumCharacters,
      maximumHashtags: fittedIdentityConstraints.maximumHashtags,
      minimumHashtags: fittedIdentityConstraints.minimumHashtags,
      requestedContentLocale: "fa",
      source: null,
    },
  );
  assert.equal(identityAfterFitting.failures.length, 0);
  assert.equal(identityAfterFitting.body.includes(requiredUrl), false);
  assert.equal(
    fittedIdentitySchema.safeParse(identityAfterFitting).success,
    false,
  );

  const sourceWithInternalIdentity = {
    ...source,
    copyVariantId: "internal-copy-variant-id",
    mediaBrandKey: "internal-media-brand-key",
    platformDraftId: "internal-platform-draft-id",
    publishSource: {
      attribution: "internal-source-attribution",
      canonicalUrl: "https://internal-source.example.test/private",
    },
  };
  const prompt = copyVariantTranslationPrompt(
    sourceWithInternalIdentity,
    "fa",
    constraints,
  );
  assert.ok(prompt.includes("Persian"));
  assert.ok(prompt.includes(constraints.canonicalHashtag));
  assert.ok(prompt.includes("Format numbers, currencies, percentages, dates"));
  assert.equal(
    [
      sourceWithInternalIdentity.copyVariantId,
      sourceWithInternalIdentity.mediaBrandKey,
      sourceWithInternalIdentity.platformDraftId,
      sourceWithInternalIdentity.publishSource.attribution,
      sourceWithInternalIdentity.publishSource.canonicalUrl,
    ].some((metadata) => prompt.includes(metadata)),
    false,
  );

  const providerSchema = asSchema(schema);
  const jsonSchema = z
    .object({
      additionalProperties: z.literal(false),
      required: z.array(z.string()),
      type: z.literal("object"),
    })
    .parse(await providerSchema.jsonSchema);
  assert.deepEqual([...jsonSchema.required].sort(), [
    "body",
    "hashtags",
    "headline",
  ]);
  const validate = providerSchema.validate;
  assert.ok(validate);
  assert.equal((await validate(valid)).success, true);
}

function normalizeForProbe(output: CopyVariantTranslationBundle) {
  return normalizeCopyCandidate("telegram", output, {
    canonicalHashtag: constraints.canonicalHashtag,
    emojiGraphemeCap: 3,
    maximumCharacters: constraints.maximumCharacters,
    maximumHashtags: constraints.maximumHashtags,
    minimumHashtags: constraints.minimumHashtags,
    requestedContentLocale: "fa",
    source: {
      attribution: "CoinDesk",
      canonicalUrl: "https://example.test/report",
    },
  });
}

function proveEventContract() {
  const operationId = randomUUID();
  const workspaceId = randomUUID();
  const created = durableEvents.operationCopyVariantTranslationRequested.create(
    {
      operationId,
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      workspaceId,
    },
    { id: `probe:${operationId}` },
  );
  const relayed = createInngestEvent({
    eventType: OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
    id: randomUUID(),
    payload: created.data,
    schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
  });
  assert.equal(
    copyVariantTranslationRequestedPayloadSchema.parse(relayed.data)
      .operationId,
    operationId,
  );
}

async function proveFunctionRegistration() {
  const opened = openWorkerRuntime();
  try {
    const runtime = {
      db: opened.database.db,
      identity: opened.identity,
      template: opened.template,
    };
    const appVersion = "copy-variant-translation-probe";
    const functions = createCopyVariantTranslationFunctions(
      createInngestClient(appVersion),
      runtime,
    ).map(
      (fn) =>
        fn as unknown as {
          opts: {
            id: string;
            onFailure?: unknown;
            retries?: number;
            timeouts?: { finish?: string };
            triggers?: Array<{ event?: string; if?: string }>;
          };
        },
    );
    const primary = functions.find(
      (fn) => fn.opts.id === COPY_VARIANT_TRANSLATION_FUNCTION_ID,
    );
    assert(primary);
    assert.equal(primary.opts.retries, COPY_VARIANT_TRANSLATION_RETRIES);
    assert.equal(primary.opts.timeouts?.finish, "2m");
    assert.equal(typeof primary.opts.onFailure, "function");

    const cancelled = functions.find(
      (fn) => fn.opts.id === "copy-variant-translation-cancelled",
    );
    assert(cancelled);
    assert.equal(cancelled.opts.retries, 2);
    assert.deepEqual(cancelled.opts.triggers, [
      {
        event: "inngest/function.cancelled",
        if: `event.data.function_id == 'rz-chain-reporter-worker-${COPY_VARIANT_TRANSLATION_FUNCTION_ID}'`,
      },
    ]);
  } finally {
    await opened.database.close();
  }
}

await proveOutputContract();
proveEventContract();
await proveFunctionRegistration();

console.log(
  JSON.stringify({
    eventRegistered: true,
    cancellationRegistered: true,
    functionRegistered: true,
    malformedOutputRejected: true,
    mostlyWrongScriptRejected: true,
    naturalFormattingAccepted: true,
    oversizedOutputFitted: true,
    postFitIdentityRevalidated: true,
    promptProjectsCopyOnly: true,
    providerSchemaCompatible: true,
    providerCalls: 0,
    retries: COPY_VARIANT_TRANSLATION_RETRIES,
  }),
);
