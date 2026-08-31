import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  DURABLE_EVENT_SCHEMA_VERSION,
  presentationTranslationRequestedPayloadSchema,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import {
  finalizeUsageWithResult,
  insertPendingUsage,
} from "@rz-chain-reporter/db/repositories/ai-usage-event";
import {
  persistEditorialPresentationLocalizations,
  readEditorialPresentationLocalizations,
} from "@rz-chain-reporter/db/repositories/editorial-presentation-localization";
import {
  allocateEditorialPresentationTranslationAttempt,
  claimEditorialPresentationTranslation,
  type EditorialPresentationTranslationSubject,
  startEditorialPresentationTranslation,
} from "@rz-chain-reporter/db/repositories/editorial-presentation-localization-request";
import { aiUsageEvent } from "@rz-chain-reporter/db/schema/ai-usage-event";
import { analysisModelUnit } from "@rz-chain-reporter/db/schema/analysis-model-unit";
import { analysisRun } from "@rz-chain-reporter/db/schema/analysis-run";
import { user } from "@rz-chain-reporter/db/schema/auth";
import { editorialPresentationLocalization } from "@rz-chain-reporter/db/schema/editorial-presentation-localization";
import { editorialPresentationLocalizationRequest } from "@rz-chain-reporter/db/schema/editorial-presentation-localization-request";
import { mediaBrand } from "@rz-chain-reporter/db/schema/media-brand";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { outboxEvent } from "@rz-chain-reporter/db/schema/outbox-event";
import { platformDraft } from "@rz-chain-reporter/db/schema/platform-draft";
import { promoIdea } from "@rz-chain-reporter/db/schema/promo-idea";
import { ModelGatewayInvocationError } from "@rz-chain-reporter/model-gateway/errors";
import type { ModelGateway } from "@rz-chain-reporter/model-gateway/gateway";
import type { StructuredModelInvocation } from "@rz-chain-reporter/model-gateway/types";
import { asSchema } from "ai";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  type PresentationTranslationOutput,
  presentationTranslationOutputSchema,
  presentationTranslationPrompt,
  presentationTranslationWrites,
} from "../editorial/presentation-localization";
import { workerEnv } from "../runtime/env";
import { translatedPresentationTextIsUsable } from "../translation-output";
import { notifyEditorialPresentationTranslationChanged } from "../web-cache/editorial";
import { createInngestClient } from "./client";
import { createInngestEvent, durableEvents } from "./events";
import { createWorkerFunctions } from "./functions";
import {
  executePresentationTranslation,
  PRESENTATION_TRANSLATION_FUNCTION_ID,
  PRESENTATION_TRANSLATION_RETRIES,
} from "./presentation-translation";
import {
  assertWorkspace,
  openWorkerRuntime,
  type WorkerRuntime,
} from "./runtime";

const databaseUrl = new URL(workerEnv.DATABASE_URL);
if (
  !["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname) ||
  !["/rz-chain-reporter", "/rz_chain_reporter_lifecycle_probe"].includes(
    databaseUrl.pathname,
  )
) {
  throw new Error("LOCAL_DATABASE_REQUIRED");
}

type TranslationSlots = PresentationTranslationOutput["translations"];
type TranslationSlot = keyof TranslationSlots;

const translationSlots = [
  "editorial_selection",
  "promo_idea",
  "source_item_revision",
] as const satisfies readonly TranslationSlot[];

function translationOutput(
  translations: Partial<TranslationSlots>,
): PresentationTranslationOutput {
  return {
    translations: {
      editorial_selection: null,
      promo_idea: null,
      source_item_revision: null,
      ...translations,
    },
  };
}

async function proveProviderSchema(
  subjects: readonly EditorialPresentationTranslationSubject[],
  valid: PresentationTranslationOutput,
  expectedFields: Record<TranslationSlot, readonly string[] | null>,
) {
  const providerSchema = asSchema(
    presentationTranslationOutputSchema(subjects, "fa"),
  );
  const providerJsonSchema = z
    .object({
      additionalProperties: z.literal(false),
      properties: z.object({
        translations: z.object({
          additionalProperties: z.literal(false),
          properties: z.record(
            z.enum(translationSlots),
            z.object({
              additionalProperties: z.boolean().optional(),
              properties: z.record(z.string(), z.unknown()).optional(),
              required: z.array(z.string()).optional(),
              type: z.string(),
            }),
          ),
          required: z.array(z.string()),
          type: z.literal("object"),
        }),
      }),
      required: z.array(z.string()),
      type: z.literal("object"),
    })
    .parse(await providerSchema.jsonSchema);
  const translationSchema = providerJsonSchema.properties.translations;

  assert.deepEqual(
    [...translationSchema.required].sort(),
    [...translationSlots].sort(),
  );
  for (const slot of translationSlots) {
    const expected = expectedFields[slot];
    const actual = translationSchema.properties[slot];
    assert.ok(actual);
    if (expected === null) {
      assert.equal(actual.type, "null");
      continue;
    }
    assert.equal(actual.type, "object");
    assert.equal(actual.additionalProperties, false);
    assert.deepEqual(
      Object.keys(actual.properties ?? {}).sort(),
      [...expected].sort(),
    );
    assert.deepEqual([...(actual.required ?? [])].sort(), [...expected].sort());
    for (const field of expected) {
      const fieldSchema = z
        .object({ minLength: z.number().optional(), type: z.string() })
        .parse(actual.properties?.[field]);
      if (fieldSchema.type === "string") {
        assert.equal(fieldSchema.minLength, 1);
      }
    }
    if (slot === "source_item_revision") {
      const sourceSubject = subjects.find(
        (subject) => subject.kind === "source_item_revision",
      );
      assert.ok(sourceSubject);
      const summarySchema = z
        .object({ type: z.string() })
        .parse(actual.properties?.summary);
      assert.equal(
        summarySchema.type,
        sourceSubject.summary === null ? "null" : "string",
      );
    }
  }

  const validate = providerSchema.validate;
  assert.ok(validate);
  assert.equal((await validate(valid)).success, true);
}

async function proveSchemasAndEventContract() {
  const sourceItemRevisionId = randomUUID();
  const editorialSelectionId = randomUUID();
  const promoIdeaId = randomUUID();
  const workspaceId = randomUUID();
  const operationId = randomUUID();
  const sourceSubject = {
    contentLocale: "en",
    kind: "source_item_revision",
    sourceItemRevisionId,
    summary: "Read https://example.test/report before routing.",
    title: "$BTC reaches 80,000 after ETF inflows",
  } satisfies EditorialPresentationTranslationSubject;
  const sourceWithoutSummarySubject = {
    ...sourceSubject,
    summary: null,
  } satisfies EditorialPresentationTranslationSubject;
  const editorialSubject = {
    contentLocale: "en",
    editorialSelectionId,
    kind: "editorial_selection",
    reasoning: "ETF inflows make the $BTC move relevant to #Bitcoin readers.",
  } satisfies EditorialPresentationTranslationSubject;
  const promoSubject = {
    angle: "Explain the latest Bitcoin move",
    contentLocale: "en",
    description: "A concise update about Bitcoin market activity",
    kind: "promo_idea",
    promoIdeaId,
    title: "Bitcoin market update",
  } satisfies EditorialPresentationTranslationSubject;
  const sourceTranslation = {
    summary: "پیش از مسیریابی، گزارش https://example.test/report را بخوانید.",
    title: "$BTC پس از ورود سرمایه ETF به ۸۰٬۰۰۰ رسید",
  };
  const editorialTranslation = {
    reasoning:
      "ورود سرمایه ETF حرکت $BTC را برای خوانندگان #Bitcoin مرتبط می‌کند.",
  };
  const promoTranslation = {
    angle: "توضیح تازه‌ترین حرکت بیت‌کوین",
    description: "به‌روزرسانی کوتاه درباره فعالیت بازار بیت‌کوین",
    title: "به‌روزرسانی بازار بیت‌کوین",
  };
  const combinedSubjects = [sourceSubject, editorialSubject];
  const combinedSchema = presentationTranslationOutputSchema(
    combinedSubjects,
    "fa",
  );
  const combinedOutput = combinedSchema.parse(
    translationOutput({
      editorial_selection: editorialTranslation,
      source_item_revision: sourceTranslation,
    }),
  );
  assert.equal(
    translatedPresentationTextIsUsable(
      "fa",
      "Bitcoin gained 24% on 8/30/26 after a $370 million buy.",
      "بیت‌کوین پس از خرید ۳۷۰ میلیون دلاری، در ۳۰ اوت ۲۰۲۶ بیست‌وچهار درصد رشد کرد.",
    ),
    true,
  );
  assert.equal(
    translatedPresentationTextIsUsable(
      "fa",
      "MicroStrategy ETF analysis for BTC",
      "تحلیل MicroStrategy ETF درباره BTC",
    ),
    true,
  );
  const identitySource =
    "Read https://example.test/report from @analyst about #Bitcoin and $BTC.";
  const identityTranslation =
    "گزارش https://example.test/report از @analyst درباره #Bitcoin و $BTC را بخوانید.";
  assert.equal(
    translatedPresentationTextIsUsable(
      "fa",
      identitySource,
      identityTranslation,
    ),
    true,
  );
  for (const changedIdentity of [
    identityTranslation.replace("/report", "/other"),
    identityTranslation.replace("@analyst", "@writer"),
    identityTranslation.replace("#Bitcoin", "#Crypto"),
    identityTranslation.replace("$BTC", "$ETH"),
  ]) {
    assert.equal(
      translatedPresentationTextIsUsable("fa", identitySource, changedIdentity),
      false,
    );
  }
  assert.equal(
    translatedPresentationTextIsUsable(
      "fa",
      "MicroStrategy ETF analysis for BTC",
      "MicroStrategy ETF analysis for BTC",
    ),
    false,
  );
  assert.equal(
    translatedPresentationTextIsUsable(
      "en",
      "بیت‌کوین در ۳۰ اوت رشد کرد.",
      "Bitcoin rose on August 30.",
    ),
    true,
  );
  assert.equal(
    translatedPresentationTextIsUsable("fa", "Bitcoin analysis", "..."),
    false,
  );
  assert.equal(
    translatedPresentationTextIsUsable("fa", "Bitcoin analysis", "   "),
    false,
  );
  assert.equal(translatedPresentationTextIsUsable("fa", "24%", "۲۴٪"), true);
  assert.equal(
    translatedPresentationTextIsUsable("fa", "24%", "۲۴ درصد"),
    true,
  );
  assert.equal(
    translatedPresentationTextIsUsable("fa", "24%", "wrong language"),
    false,
  );
  assert.equal(
    translatedPresentationTextIsUsable(
      "fa",
      "https://example.test/report",
      "https://example.test/report wrong language",
    ),
    false,
  );

  const scenarios = [
    {
      fields: {
        editorial_selection: null,
        promo_idea: ["angle", "description", "title"],
        source_item_revision: null,
      },
      output: translationOutput({ promo_idea: promoTranslation }),
      subjects: [promoSubject],
    },
    {
      fields: {
        editorial_selection: null,
        promo_idea: null,
        source_item_revision: ["summary", "title"],
      },
      output: translationOutput({ source_item_revision: sourceTranslation }),
      subjects: [sourceSubject],
    },
    {
      fields: {
        editorial_selection: ["reasoning"],
        promo_idea: null,
        source_item_revision: null,
      },
      output: translationOutput({
        editorial_selection: editorialTranslation,
      }),
      subjects: [editorialSubject],
    },
    {
      fields: {
        editorial_selection: ["reasoning"],
        promo_idea: null,
        source_item_revision: ["summary", "title"],
      },
      output: combinedOutput,
      subjects: combinedSubjects,
    },
  ] satisfies readonly {
    fields: Record<TranslationSlot, readonly string[] | null>;
    output: PresentationTranslationOutput;
    subjects: readonly EditorialPresentationTranslationSubject[];
  }[];

  for (const scenario of scenarios) {
    const scenarioSchema = presentationTranslationOutputSchema(
      scenario.subjects,
      "fa",
    );
    assert.equal(scenarioSchema.safeParse(scenario.output).success, true);
    await proveProviderSchema(
      scenario.subjects,
      scenario.output,
      scenario.fields,
    );
  }

  const numericHeavySubjects = [
    {
      contentLocale: "en",
      kind: "source_item_revision",
      sourceItemRevisionId,
      summary:
        "The company bought 4,603 BTC for $369.7 million on 8/30/26, lifting holdings to 636,505 BTC. Shares moved 6.71% while Bitcoin traded between $75,412 and $80,318.",
      title: "MicroStrategy Ends 10-Week Pause With $370 Million Bitcoin Buy",
    },
    {
      contentLocale: "en",
      editorialSelectionId,
      kind: "editorial_selection",
      reasoning:
        "The $370 million purchase after a 10-week pause is relevant to Bitcoin readers.",
    },
  ] satisfies EditorialPresentationTranslationSubject[];
  const numericHeavySchema = presentationTranslationOutputSchema(
    numericHeavySubjects,
    "fa",
  );
  const numericHeavyOutput = translationOutput({
    editorial_selection: {
      reasoning:
        "خرید ۳۷۰ میلیون دلاری پس از وقفه‌ای ده‌هفته‌ای برای خوانندگان بیت‌کوین اهمیت دارد.",
    },
    source_item_revision: {
      summary:
        "این شرکت در ۳۰ اوت ۲۰۲۶ با پرداخت ۳۶۹٫۷ میلیون دلار، ۴٬۶۰۳ بیت‌کوین خرید و دارایی خود را به ۶۳۶٬۵۰۵ بیت‌کوین رساند. سهام ۶٫۷۱ درصد جابه‌جا شد و بیت‌کوین در بازه ۷۵٬۴۱۲ تا ۸۰٬۳۱۸ دلار معامله شد.",
      title:
        "مایکرواستراتژی پس از وقفه‌ای ده‌هفته‌ای، خرید ۳۷۰ میلیون دلاری بیت‌کوین را از سر گرفت",
    },
  });
  assert.equal(numericHeavySchema.safeParse(numericHeavyOutput).success, true);
  assert.equal(
    numericHeavySchema.safeParse({
      translations: {
        ...numericHeavyOutput.translations,
        source_item_revision: {
          ...numericHeavyOutput.translations.source_item_revision,
          summary: "",
        },
      },
    }).success,
    false,
  );
  assert.equal(
    numericHeavySchema.safeParse({
      translations: {
        ...numericHeavyOutput.translations,
        editorial_selection: {},
      },
    }).success,
    false,
  );

  const sourceWithoutSummarySchema = presentationTranslationOutputSchema(
    [sourceWithoutSummarySubject],
    "fa",
  );
  assert.equal(
    sourceWithoutSummarySchema.safeParse(
      translationOutput({
        source_item_revision: { ...sourceTranslation, summary: null },
      }),
    ).success,
    true,
  );
  assert.equal(
    sourceWithoutSummarySchema.safeParse(
      translationOutput({ source_item_revision: sourceTranslation }),
    ).success,
    false,
  );
  assert.equal(
    presentationTranslationOutputSchema([sourceSubject], "fa").safeParse(
      translationOutput({
        source_item_revision: { ...sourceTranslation, summary: null },
      }),
    ).success,
    false,
  );
  await proveProviderSchema(
    [sourceWithoutSummarySubject],
    translationOutput({
      source_item_revision: { ...sourceTranslation, summary: null },
    }),
    {
      editorial_selection: null,
      promo_idea: null,
      source_item_revision: ["summary", "title"],
    },
  );

  const writes = presentationTranslationWrites(
    combinedSubjects,
    combinedOutput,
  );
  assert.deepEqual(
    writes.map((write) => write.kind),
    ["source_item_revision", "editorial_selection"],
  );
  assert.equal(
    combinedSchema.safeParse(
      translationOutput({ editorial_selection: editorialTranslation }),
    ).success,
    false,
  );
  assert.equal(
    combinedSchema.safeParse(
      translationOutput({
        editorial_selection: editorialTranslation,
        promo_idea: promoTranslation,
        source_item_revision: sourceTranslation,
      }),
    ).success,
    false,
  );
  assert.equal(
    combinedSchema.safeParse({
      translations: {
        ...combinedOutput.translations,
        extra: null,
      },
    }).success,
    false,
  );
  assert.equal(
    combinedSchema.safeParse({
      translations: {
        editorial_selection: editorialTranslation,
        promo_idea: null,
      },
    }).success,
    false,
  );
  assert.equal(
    combinedSchema.safeParse(
      translationOutput({
        editorial_selection: editorialTranslation,
        source_item_revision: {
          ...sourceTranslation,
          title: "Bitcoin remains below $80,000",
        },
      }),
    ).success,
    false,
  );
  assert.throws(() =>
    presentationTranslationOutputSchema([promoSubject, promoSubject], "fa"),
  );

  const prompt = presentationTranslationPrompt(combinedSubjects, "fa");
  assert.ok(prompt.includes("Persian"));
  assert.ok(prompt.includes("$BTC"));
  assert.ok(prompt.includes("Format numbers, currencies, percentages, dates"));
  assert.ok(prompt.includes("https://example.test/report"));

  const created =
    durableEvents.operationPresentationTranslationRequested.create(
      {
        operationId,
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        workspaceId,
      },
      { id: `probe:${operationId}` },
    );
  const relayed = createInngestEvent({
    eventType: "operation/presentation-translation.requested",
    id: randomUUID(),
    payload: created.data,
    schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
  });
  assert.equal(
    presentationTranslationRequestedPayloadSchema.parse(relayed.data)
      .operationId,
    operationId,
  );
}

function proveFunctionRegistration(runtime: WorkerRuntime) {
  const appVersion = "presentation-translation-probe";
  const functions = createWorkerFunctions(
    createInngestClient(appVersion),
    runtime,
    { diagnosticsEnabled: false },
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
  const descriptor = functions.find(
    (fn) => fn.opts.id === PRESENTATION_TRANSLATION_FUNCTION_ID,
  );
  assert.ok(descriptor);
  assert.equal(descriptor.opts.retries, PRESENTATION_TRANSLATION_RETRIES);
  assert.equal(descriptor.opts.timeouts?.finish, "2m");
  assert.equal(typeof descriptor.opts.onFailure, "function");
  const cancelled = functions.find(
    (fn) => fn.opts.id === "presentation-translation-cancelled",
  );
  assert(cancelled);
  assert.equal(cancelled.opts.retries, 2);
  assert.deepEqual(cancelled.opts.triggers, [
    {
      event: "inngest/function.cancelled",
      if: `event.data.function_id == 'rz-chain-reporter-worker-${PRESENTATION_TRANSLATION_FUNCTION_ID}'`,
    },
  ]);
}

const executionIds = {
  actor: `presentation-translation-worker-${randomUUID()}`,
  analysisOperation: randomUUID(),
  analysisRun: randomUUID(),
  analysisUnit: randomUUID(),
  completePromo: randomUUID(),
  failurePromo: randomUUID(),
  mediaBrand: randomUUID(),
  platformDraft: randomUUID(),
  successPromo: randomUUID(),
};
const mediaBrandKey = `presentation-translation-worker-${executionIds.mediaBrand}`;

async function insertExecutionFixture(executor: Executor, workspaceId: string) {
  await executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    await tx.insert(user).values({
      id: executionIds.actor,
      email: `${executionIds.actor}@example.test`,
      name: "Presentation Translation Worker Probe",
    });
    await tx.insert(mediaBrand).values({
      id: executionIds.mediaBrand,
      workspaceId,
      key: mediaBrandKey,
      name: "Presentation Translation Worker Probe",
      sortOrder: 9_999,
    });
    await tx.insert(operation).values({
      id: executionIds.analysisOperation,
      workspaceId,
      actor: executionIds.actor,
      commandType: "analysis-run:promo",
      idempotencyKey: executionIds.analysisOperation,
      requestHash: executionIds.analysisOperation,
      lifecycle: "succeeded",
    });
    await tx.insert(analysisRun).values({
      id: executionIds.analysisRun,
      workspaceId,
      kind: "promo",
      operationId: executionIds.analysisOperation,
      configuration: {
        kind: "promo",
        models: ["probe"],
        platforms: ["x"],
        promo: {
          brands: [mediaBrandKey],
          prompts: { [mediaBrandKey]: "Synthetic worker probe" },
        },
      },
      semanticStatus: "skipped",
      templateFingerprint: "presentation-translation-worker-probe",
    });
    await tx.insert(analysisModelUnit).values({
      id: executionIds.analysisUnit,
      workspaceId,
      analysisRunId: executionIds.analysisRun,
      mediaBrandId: executionIds.mediaBrand,
      modelOptionKey: "probe",
      taskKey: "promo-ideas:probe",
      status: "succeeded",
    });
    await tx.insert(promoIdea).values([
      {
        id: executionIds.completePromo,
        workspaceId,
        analysisModelUnitId: executionIds.analysisUnit,
        rank: 1,
        title: "Completed before execution",
        description: "A translation completed before worker execution",
        angle: "Prove execution skips the provider",
      },
      {
        id: executionIds.successPromo,
        workspaceId,
        analysisModelUnitId: executionIds.analysisUnit,
        rank: 2,
        title: "Bitcoin market update",
        description: "A concise update about Bitcoin market activity",
        angle: "Explain the latest Bitcoin move",
      },
      {
        id: executionIds.failurePromo,
        workspaceId,
        analysisModelUnitId: executionIds.analysisUnit,
        rank: 3,
        title: "Ethereum market update",
        description: "A concise update about Ethereum market activity",
        angle: "Explain the latest Ethereum move",
      },
    ]);
  });
}

async function proveExecution(
  runtime: WorkerRuntime,
  workspaceId: string,
  operationIds: string[],
) {
  const completeOperationId = await startTranslation(
    runtime.db,
    workspaceId,
    executionIds.completePromo,
    "complete-before-execution",
  );
  operationIds.push(completeOperationId);
  const completeClaim = await claimTranslation(
    runtime.db,
    workspaceId,
    completeOperationId,
    "complete-before-execution",
  );
  const completeClaimFence = {
    claimedBy: completeClaim.operation.claimedBy ?? "",
    expectedVersion: completeClaim.operation.version,
  };
  const completeAttempt = await allocateEditorialPresentationTranslationAttempt(
    runtime.db,
    workspaceId,
    completeOperationId,
    completeOperationId,
    completeClaimFence,
  );
  assert.equal(completeAttempt.status, "allocated");
  if (completeAttempt.status !== "allocated") {
    throw new Error("TRANSLATION_ATTEMPT_NOT_ALLOCATED");
  }
  await persistEditorialPresentationLocalizations(runtime.db, workspaceId, [
    {
      angle: "اثبات رد شدن فراخوانی ارائه‌دهنده",
      description: "ترجمه‌ای که پیش از اجرای کارگر تکمیل شد",
      kind: "promo_idea",
      operationAttemptId: completeAttempt.attempt.id,
      presentationLocale: "fa",
      promoIdeaId: executionIds.completePromo,
      title: "تکمیل پیش از اجرا",
    },
  ]);
  const completeGateway = new ProbeGateway(runtime.db, translationOutput({}));
  const completedBeforeExecution = await executePresentationTranslation(
    runtime,
    completeGateway,
    {
      claimFence: completeClaimFence,
      operationId: completeOperationId,
      workspaceId,
    },
  );
  assert.equal(completedBeforeExecution.lifecycle, "succeeded");
  assert.equal(completeGateway.calls, 0);
  assert.deepEqual(completeGateway.attemptIds, []);

  const successOperationId = await startTranslation(
    runtime.db,
    workspaceId,
    executionIds.successPromo,
    "success",
  );
  operationIds.push(successOperationId);
  const successClaim = await claimTranslation(
    runtime.db,
    workspaceId,
    successOperationId,
    "success",
  );
  const successGateway = new ProbeGateway(
    runtime.db,
    translationOutput({
      promo_idea: {
        angle: "توضیح تازه‌ترین حرکت بیت‌کوین",
        description: "به‌روزرسانی کوتاه درباره فعالیت بازار بیت‌کوین",
        title: "به‌روزرسانی بازار بیت‌کوین",
      },
    }),
    async () => {
      await runtime.db.insert(platformDraft).values({
        id: executionIds.platformDraft,
        workspaceId,
        lanePosition: 1,
        mediaBrandId: executionIds.mediaBrand,
        platform: "x",
        promoIdeaId: executionIds.successPromo,
      });
    },
  );
  const succeeded = await executePresentationTranslation(
    runtime,
    successGateway,
    {
      claimFence: {
        claimedBy: successClaim.operation.claimedBy ?? "",
        expectedVersion: successClaim.operation.version,
      },
      operationId: successOperationId,
      workspaceId,
    },
  );
  assert.equal(succeeded.lifecycle, "succeeded");
  assert.deepEqual(succeeded.platformDraftIds, [executionIds.platformDraft]);
  assert.equal(successGateway.calls, 1);
  assert.deepEqual(successGateway.attemptIds, [successOperationId]);

  const replay = await startEditorialPresentationTranslation(
    runtime.db,
    workspaceId,
    translationCommand(executionIds.successPromo, "success"),
  );
  assert.equal(replay.status, "replayed");
  const replayClaim = await claimEditorialPresentationTranslation(
    runtime.db,
    workspaceId,
    claimInput(successOperationId, "replay"),
  );
  assert.equal(replayClaim.status, "settled");
  assert.equal(successGateway.calls, 1);

  const failureOperationId = await startTranslation(
    runtime.db,
    workspaceId,
    executionIds.failurePromo,
    "failure",
  );
  operationIds.push(failureOperationId);
  const failureClaim = await claimTranslation(
    runtime.db,
    workspaceId,
    failureOperationId,
    "failure",
  );
  const failureGateway = new ProbeGateway(
    runtime.db,
    translationOutput({
      promo_idea: {
        angle: "Explain the latest Ethereum move",
        description: "A concise update about Ethereum market activity",
        title: "Ethereum market update",
      },
    }),
  );
  const failed = await executePresentationTranslation(runtime, failureGateway, {
    claimFence: {
      claimedBy: failureClaim.operation.claimedBy ?? "",
      expectedVersion: failureClaim.operation.version,
    },
    operationId: failureOperationId,
    workspaceId,
  });
  assert.equal(failed.lifecycle, "failed");
  assert.equal(failureGateway.calls, 1);
  assert.deepEqual(failureGateway.attemptIds, [failureOperationId]);

  const localizations = await readEditorialPresentationLocalizations(
    runtime.db,
    workspaceId,
    [
      {
        kind: "promo_idea",
        presentationLocale: "fa",
        promoIdeaId: executionIds.completePromo,
      },
      {
        kind: "promo_idea",
        presentationLocale: "fa",
        promoIdeaId: executionIds.successPromo,
      },
      {
        kind: "promo_idea",
        presentationLocale: "fa",
        promoIdeaId: executionIds.failurePromo,
      },
    ],
  );
  assert.deepEqual(
    localizations.map((localization) => localization.promoIdeaId).sort(),
    [executionIds.completePromo, executionIds.successPromo].sort(),
  );

  const operationRows = await runtime.db
    .select({ id: operation.id, lifecycle: operation.lifecycle })
    .from(operation)
    .where(
      inArray(operation.id, [
        executionIds.analysisOperation,
        completeOperationId,
        successOperationId,
        failureOperationId,
      ]),
    );
  assert.equal(
    lifecycleOf(operationRows, executionIds.analysisOperation),
    "succeeded",
  );
  assert.equal(lifecycleOf(operationRows, completeOperationId), "succeeded");
  assert.equal(lifecycleOf(operationRows, successOperationId), "succeeded");
  assert.equal(lifecycleOf(operationRows, failureOperationId), "failed");

  const attempts = await runtime.db
    .select({
      failureCode: operationAttempt.failureCode,
      operationId: operationAttempt.operationId,
      outcome: operationAttempt.outcome,
    })
    .from(operationAttempt)
    .where(
      inArray(operationAttempt.operationId, [
        completeOperationId,
        successOperationId,
        failureOperationId,
      ]),
    );
  assert.equal(attempts.length, 3);
  assert.deepEqual(
    [completeOperationId, successOperationId, failureOperationId].map(
      (operationId) => {
        const attempt = attempts.find((row) => row.operationId === operationId);
        return [
          operationId,
          attempt?.outcome ?? null,
          attempt?.failureCode ?? null,
        ];
      },
    ),
    [
      [completeOperationId, "succeeded", null],
      [successOperationId, "succeeded", null],
      [failureOperationId, "failed_terminal", "STRUCTURED_OUTPUT_INVALID"],
    ],
  );

  const usageRows = await runtime.db
    .select({
      operationId: aiUsageEvent.operationId,
      status: aiUsageEvent.status,
    })
    .from(aiUsageEvent)
    .where(
      inArray(aiUsageEvent.operationId, [
        completeOperationId,
        successOperationId,
        failureOperationId,
      ]),
    );
  assert.equal(usageRows.length, 2);
  assert.equal(
    usageRows.some((usage) => usage.operationId === completeOperationId),
    false,
  );
  assert.deepEqual(
    [successOperationId, failureOperationId].map((operationId) => [
      operationId,
      usageRows.find((usage) => usage.operationId === operationId)?.status ??
        null,
    ]),
    [
      [successOperationId, "succeeded"],
      [failureOperationId, "failed"],
    ],
  );
}

async function startTranslation(
  executor: Executor,
  workspaceId: string,
  promoIdeaId: string,
  key: string,
) {
  const started = await startEditorialPresentationTranslation(
    executor,
    workspaceId,
    translationCommand(promoIdeaId, key),
  );
  assert.equal(started.status, "created");
  if (started.status !== "created") throw new Error("TRANSLATION_NOT_CREATED");
  return started.operationId;
}

function translationCommand(promoIdeaId: string, key: string) {
  return {
    actor: executionIds.actor,
    idempotencyKey: `presentation-translation-worker:${key}`,
    origin: { kind: "promo_idea" as const, promoIdeaId },
    presentationLocale: "fa" as const,
    requestHash: `presentation-translation-worker:${key}`,
    requestId: `presentation-translation-worker:${key}`,
  };
}

async function claimTranslation(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  key: string,
) {
  const claim = await claimEditorialPresentationTranslation(
    executor,
    workspaceId,
    claimInput(operationId, key),
  );
  assert.equal(claim.status, "claimed");
  if (claim.status !== "claimed") throw new Error("TRANSLATION_NOT_CLAIMED");
  return claim;
}

function claimInput(operationId: string, key: string) {
  const now = new Date();
  return {
    claimedBy: `presentation-translation-worker:${key}`,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    now,
    operationId,
  };
}

function lifecycleOf(
  rows: { id: string; lifecycle: string }[],
  operationId: string,
) {
  return rows.find((row) => row.id === operationId)?.lifecycle;
}

class ProbeGateway implements ModelGateway {
  attemptIds: string[] = [];
  calls = 0;

  constructor(
    private readonly executor: Executor,
    private readonly candidate: unknown,
    private readonly beforeFinalize: () => Promise<void> = async () => {},
  ) {}

  async embedMany(): Promise<never> {
    throw new Error("PRESENTATION_TRANSLATION_EMBEDDING_FORBIDDEN");
  }

  async invokeStructured<TOutput>(input: StructuredModelInvocation<TOutput>) {
    this.calls += 1;
    assert.equal(input.deadlineMs, 60_000);
    assert.equal(input.maxOutputTokens, 4_096);
    this.attemptIds.push(input.operationAttemptId);
    const claimFence = input.claimFence
      ? { operationId: input.operationId, ...input.claimFence }
      : undefined;
    const pending = await insertPendingUsage(this.executor, input.workspaceId, {
      apiKind: "chat",
      backend: "local",
      invocationKey: input.invocationKey,
      operationAttemptId: input.operationAttemptId,
      operationId: input.operationId,
      providerGateway: "ollama",
      requestedModel: "deterministic-translation-probe",
      taskKey: input.taskKey,
      ...(claimFence ? { claimFence: { ...claimFence, now: new Date() } } : {}),
    });
    assert.equal(pending.inserted, true);
    const observation = {
      costAuthority: "local" as const,
      finishReason: "stop",
      resolvedModel: "deterministic-translation-probe",
      totalTokens: 3,
    };
    const parsed = input.schema.safeParse(this.candidate);
    await this.beforeFinalize();

    if (!parsed.success) {
      await finalizeUsageWithResult(
        this.executor,
        input.workspaceId,
        {
          claimFence,
          id: pending.event.id,
          status: "failed",
          ...observation,
        },
        async (tx) => {
          if (!input.persistDefiniteFailure) {
            throw new Error(
              "PRESENTATION_TRANSLATION_FAILURE_CALLBACK_MISSING",
            );
          }
          await input.persistDefiniteFailure(tx, {
            code: "STRUCTURED_OUTPUT_INVALID",
          });
        },
      );
      throw new ModelGatewayInvocationError("STRUCTURED_OUTPUT_INVALID", {
        usageEventId: pending.event.id,
      });
    }

    await finalizeUsageWithResult(
      this.executor,
      input.workspaceId,
      {
        claimFence,
        id: pending.event.id,
        status: "succeeded",
        ...observation,
      },
      (tx) => input.persistResult(tx, parsed.data),
    );
    return { output: parsed.data, usageEventId: pending.event.id };
  }
}

async function proveFreshnessOrder(workspaceId: string) {
  const order: string[] = [];
  const step = {
    realtime: {
      publish: async (id: string) => {
        order.push(id);
      },
    },
    run: async (id: string) => {
      order.push(id);
      return "accepted";
    },
    sleep: async (id: string) => {
      order.push(id);
    },
  } as never;
  await notifyEditorialPresentationTranslationChanged(
    step,
    workspaceId,
    {
      analysisRunId: executionIds.analysisRun,
      code: "succeeded",
      operationId: executionIds.analysisOperation,
      platformDraftIds: [executionIds.platformDraft],
    },
    executionIds.actor,
  );
  assert.deepEqual(order, [
    "notify-editorial-cache-translation",
    "let-web-cache-flush-translation",
    "publish-editorial-changed-translation",
    `publish-drafts-changed-translation-${executionIds.platformDraft}`,
    "publish-usage-ledger",
  ]);
}

async function cleanupExecutionFixture(
  runtime: WorkerRuntime,
  operationIds: string[],
) {
  const workspace = await assertWorkspace(runtime);
  await runtime.db.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspace.workspaceId);
    await tx
      .delete(platformDraft)
      .where(eq(platformDraft.id, executionIds.platformDraft));
    await tx
      .delete(editorialPresentationLocalization)
      .where(
        inArray(editorialPresentationLocalization.promoIdeaId, [
          executionIds.completePromo,
          executionIds.successPromo,
          executionIds.failurePromo,
        ]),
      );
    if (operationIds.length > 0) {
      await tx
        .delete(aiUsageEvent)
        .where(inArray(aiUsageEvent.operationId, operationIds));
      await tx
        .delete(editorialPresentationLocalizationRequest)
        .where(
          inArray(
            editorialPresentationLocalizationRequest.operationId,
            operationIds,
          ),
        );
      await tx
        .delete(outboxEvent)
        .where(inArray(outboxEvent.operationId, operationIds));
      await tx
        .delete(operationAttempt)
        .where(inArray(operationAttempt.operationId, operationIds));
      await tx.delete(operation).where(inArray(operation.id, operationIds));
    }
    await tx
      .delete(promoIdea)
      .where(
        inArray(promoIdea.id, [
          executionIds.completePromo,
          executionIds.successPromo,
          executionIds.failurePromo,
        ]),
      );
    await tx
      .delete(analysisModelUnit)
      .where(eq(analysisModelUnit.id, executionIds.analysisUnit));
    await tx
      .delete(analysisRun)
      .where(eq(analysisRun.id, executionIds.analysisRun));
    await tx
      .delete(operation)
      .where(eq(operation.id, executionIds.analysisOperation));
    await tx
      .delete(mediaBrand)
      .where(eq(mediaBrand.id, executionIds.mediaBrand));
    await tx.delete(user).where(eq(user.id, executionIds.actor));
  });
}

async function main() {
  await proveSchemasAndEventContract();
  const opened = openWorkerRuntime();
  const runtime = {
    db: opened.database.db,
    identity: opened.identity,
    template: opened.template,
  };
  const operationIds: string[] = [];
  try {
    proveFunctionRegistration(runtime);
    const installation = await assertWorkspace(runtime);
    await insertExecutionFixture(runtime.db, installation.workspaceId);
    await proveExecution(runtime, installation.workspaceId, operationIds);
    await proveFreshnessOrder(installation.workspaceId);
    console.log(
      JSON.stringify({
        analysisUnaffected: true,
        eventRegistered: true,
        failureSettled: true,
        functionRegistered: true,
        invalidPartialRejected: true,
        invalidWrongLocaleRejected: true,
        lane2BeforeLane3: true,
        naturalFormattingAccepted: true,
        providerSchemaCompatible: true,
        replayProviderCalls: 0,
        retries: PRESENTATION_TRANSLATION_RETRIES,
        successBundleRows: 1,
      }),
    );
  } finally {
    await cleanupExecutionFixture(runtime, operationIds);
    await opened.database.close();
  }
}

await main();
