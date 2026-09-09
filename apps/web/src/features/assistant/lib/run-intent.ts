import type { RunConfigurationTransport } from "@rz-chain-reporter/contracts";

import type {
  AssistantPendingRun,
  AssistantRunFormLoadResponse,
  AssistantRunIntent,
  AssistantRunIntentPatch,
  AssistantRunQuestion,
} from "../schemas/approval";
import { assistantRunSourceModeSchema } from "../schemas/approval";

export type RunIntentResolution = {
  configuration: RunConfigurationTransport | null;
  pendingRun: AssistantPendingRun;
  question: AssistantRunQuestion | null;
};

export function resolveRunToolIntent({
  form,
  pendingRun,
  retainedRun,
  toolInput,
}: {
  form: AssistantRunFormLoadResponse;
  pendingRun: AssistantPendingRun | null;
  retainedRun: AssistantPendingRun | null;
  toolInput: AssistantRunIntentPatch;
}): RunIntentResolution {
  return resolveRunIntent(
    retainedRun?.intent ?? pendingRun?.intent ?? null,
    retainedRun ? {} : toolInput,
    form,
  );
}

export function resolveRunIntent(
  current: AssistantRunIntent | null,
  patch: AssistantRunIntentPatch,
  form: AssistantRunFormLoadResponse,
): RunIntentResolution {
  const previous = patch.reusePrevious
    ? form.options.previousRun?.configuration
    : null;
  const previousIntent = previous ? intentOf(previous) : null;
  const changedKind =
    patch.kind !== undefined &&
    current?.kind !== undefined &&
    patch.kind !== current.kind;
  const base = patch.useDefaults
    ? { kind: current?.kind }
    : changedKind
      ? {}
      : (previousIntent ?? current ?? {});
  const intent: AssistantRunIntent = {
    ...base,
    ...withoutControlFlags(patch),
  };

  if (patch.sourceMode !== undefined) {
    intent.sourceIds = undefined;
  }
  if (changedKind) {
    intent.sourceIds = undefined;
    intent.sourceMode = patch.sourceMode;
    intent.promoPrompts = undefined;
    intent.promoText = patch.promoText;
  }

  if (!intent.kind) return pending(intent, "kind");

  const models = intent.modelKeys ?? [...form.options.defaults.models];
  const platforms = intent.platforms ?? [...form.options.defaults.platforms];
  const defaultBrands =
    intent.kind === "promo"
      ? form.options.defaults.brands.filter((key) =>
          form.options.brands.some(
            (brand) => brand.key === key && brand.promoEnabled,
          ),
        )
      : [...form.options.defaults.brands];
  const brands = intent.brandKeys ?? defaultBrands;
  const resolved: AssistantRunIntent = {
    ...intent,
    brandKeys: brands,
    modelKeys: models,
    platforms,
  };

  if (intent.kind === "promo") {
    const eligibleBrandKeys = new Set(
      form.options.brands.flatMap((brand) =>
        brand.promoEnabled ? [brand.key] : [],
      ),
    );
    if (
      brands.length === 0 ||
      brands.some((brand) => !eligibleBrandKeys.has(brand))
    ) {
      return pending(resolved, "promoBrands");
    }
    const prompts = { ...intent.promoPrompts };
    if (intent.promoText) {
      for (const brand of brands) prompts[brand] = intent.promoText;
    }
    resolved.promoPrompts = prompts;
    if (brands.some((brand) => !prompts[brand]?.trim())) {
      return pending(resolved, "promoText");
    }
    return complete(resolved, {
      kind: "promo",
      models,
      platforms,
      promo: { brands, prompts },
    });
  }

  const enabled = form.sources.filter(
    (source) => source.lifecycle === "enabled",
  );
  const sourceIds = resolveSourceIds(resolved, enabled, form);
  if (sourceIds.length === 0) return pending(resolved, "sources");
  resolved.sourceIds = sourceIds;

  const orderingMode =
    intent.orderingMode ?? form.options.defaults.orderingMode;
  const topics = intent.topics ?? [];
  if (orderingMode === "keywords" && topics.length === 0) {
    return pending(resolved, "topics");
  }

  return complete(resolved, {
    kind: "news",
    brands,
    models,
    platforms,
    sourceIds,
    windowHours: intent.windowHours ?? form.options.defaults.windowHours,
    enrichmentEnabled:
      intent.enrichmentEnabled ?? form.options.defaults.enrichment,
    telegramOnly:
      intent.telegramOnly ?? intent.sourceMode === "telegram_enabled",
    orderingMode,
    topN: intent.topN ?? form.options.defaults.topN,
    topics,
  });
}

function resolveSourceIds(
  intent: AssistantRunIntent,
  enabled: AssistantRunFormLoadResponse["sources"],
  form: AssistantRunFormLoadResponse,
) {
  const enabledIds = new Set(enabled.map((source) => source.id));
  if (intent.sourceIds?.some((id) => enabledIds.has(id))) {
    return intent.sourceIds.filter((id) => enabledIds.has(id));
  }

  const mode = intent.sourceMode;
  if (mode === "all_enabled") return enabled.map((source) => source.id);
  if (mode === "rss_enabled") {
    return enabled.flatMap((source) =>
      source.origin === "rss" ? [source.id] : [],
    );
  }
  if (mode === "telegram_enabled") {
    return enabled.flatMap((source) =>
      source.origin === "telegram_public" ? [source.id] : [],
    );
  }

  const defaults = form.options.defaults.sourceKeys ?? [];
  if (defaults.length === 0) return [];
  const defaultKeys = new Set(defaults);
  return enabled.flatMap((source) =>
    defaultKeys.has(source.key) ? [source.id] : [],
  );
}

function pending(
  intent: AssistantRunIntent,
  question: AssistantRunQuestion,
): RunIntentResolution {
  return {
    configuration: null,
    pendingRun: { intent, question },
    question,
  };
}

function complete(
  intent: AssistantRunIntent,
  configuration: RunConfigurationTransport,
): RunIntentResolution {
  return {
    configuration,
    pendingRun: { intent, question: null },
    question: null,
  };
}

function withoutControlFlags(patch: AssistantRunIntentPatch) {
  const {
    reusePrevious: _reusePrevious,
    useDefaults: _useDefaults,
    ...intent
  } = patch;
  return intent;
}

function intentOf(
  configuration: RunConfigurationTransport,
): AssistantRunIntent {
  if (configuration.kind === "promo") {
    return {
      kind: "promo",
      brandKeys: configuration.promo.brands,
      modelKeys: configuration.models,
      platforms: configuration.platforms,
      promoPrompts: configuration.promo.prompts,
    };
  }
  return {
    kind: "news",
    brandKeys: configuration.brands,
    modelKeys: configuration.models,
    platforms: configuration.platforms,
    sourceIds: configuration.sourceIds,
    windowHours: configuration.windowHours,
    enrichmentEnabled: configuration.enrichmentEnabled,
    telegramOnly: configuration.telegramOnly,
    orderingMode: configuration.orderingMode,
    topN: configuration.topN,
    topics: configuration.topics,
  };
}

export function runAnswerPatch(
  question: AssistantRunQuestion,
  value: string,
  intent: AssistantRunIntent,
  form: AssistantRunFormLoadResponse,
): AssistantRunIntentPatch {
  if (question === "kind") {
    return value === "promo" ? { kind: "promo" } : { kind: "news" };
  }
  if (question === "sources") {
    const sourceMode = assistantRunSourceModeSchema.safeParse(value);
    return sourceMode.success ? { sourceMode: sourceMode.data } : {};
  }
  if (question === "promoBrands") {
    const eligibleBrandKeys = new Set(
      form.options.brands.flatMap((brand) =>
        brand.promoEnabled ? [brand.key] : [],
      ),
    );
    const preserved =
      intent.brandKeys?.filter((brand) => eligibleBrandKeys.has(brand)) ?? [];
    return { brandKeys: [...new Set([...preserved, value])] };
  }
  if (question === "topics") {
    return { topics: value.split(/[,،\n]/u).map((topic) => topic.trim()) };
  }
  return { promoText: value };
}
