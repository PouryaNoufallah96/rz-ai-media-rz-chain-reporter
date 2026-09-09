import type {
  AssistantMarketActionInput,
  AssistantMarketQuestion,
  AssistantMarketToolInput,
  AssistantMarketValues,
  AssistantPendingMarket,
} from "../schemas/approval";
import {
  assistantMarketActionInputSchema,
  assistantMarketToolInputSchema,
  assistantMarketValuesSchema,
} from "../schemas/approval";

type Instrument = { id: string; key: string; name: string; symbol: string };

export function resolveMarketToolIntent({
  pendingMarket,
  retainedMarket,
  toolInput,
}: {
  pendingMarket: AssistantPendingMarket | null;
  retainedMarket: AssistantPendingMarket | null;
  toolInput: AssistantMarketToolInput;
}): AssistantMarketToolInput {
  const current = retainedMarket ?? pendingMarket;
  const corrected = current
    ? {
        ...current,
        intent: mergePendingMarket(current, {
          action: "create",
          ...current.values,
        }),
      }
    : null;
  return retainedMarket && corrected
    ? corrected.intent
    : mergePendingMarket(corrected, toolInput);
}

export function initialMarketValues(
  input: AssistantMarketActionInput | null | undefined,
  pending: AssistantMarketValues,
  question: AssistantMarketQuestion | null = null,
): AssistantMarketValues {
  const primaryInstrumentIds =
    input?.primaryInstrumentIds ?? pending.primaryInstrumentIds;
  const values: AssistantMarketValues = {
    primaryInstrumentIds,
    brandingInstrumentId:
      input?.brandingInstrumentId ??
      pending.brandingInstrumentId ??
      primaryInstrumentIds?.[0],
    comparisonCatalogIdentities:
      input?.comparisonCatalogIdentities ?? pending.comparisonCatalogIdentities,
    period: input?.period ?? pending.period,
    scale: input?.scale ?? pending.scale,
    outputFormat: input?.outputFormat ?? pending.outputFormat,
    contentLocale: input?.contentLocale ?? pending.contentLocale,
  };
  if (question) values[question] = undefined;
  if (question === "primaryInstrumentIds")
    values.brandingInstrumentId = undefined;
  return values;
}

export function mergePendingMarket(
  current: AssistantPendingMarket | null,
  patch: AssistantMarketToolInput,
): AssistantMarketToolInput {
  if (!current || !sameSetup(current.intent, patch)) return patch;

  const merged = definedMerge(current.intent, patch);
  if ("primaryInstrumentRefs" in patch && patch.primaryInstrumentRefs) {
    delete merged.primaryInstrumentIds;
  }
  if ("primaryInstrumentIds" in patch && patch.primaryInstrumentIds) {
    delete merged.primaryInstrumentRefs;
  }
  return assistantMarketToolInputSchema.parse(merged);
}

export function mergeMarketValues(
  current: AssistantMarketValues,
  patch: Partial<AssistantMarketValues>,
): AssistantMarketValues {
  return assistantMarketValuesSchema.parse(definedMerge(current, patch));
}

export function resolveMarketToolInput(
  input: AssistantMarketToolInput,
  instruments: readonly Instrument[],
  primaryInstrumentIdsOverride?: readonly string[],
): {
  input: AssistantMarketActionInput | null;
  question: AssistantMarketQuestion | null;
} {
  const { primaryInstrumentRefs, ...candidate } = input;
  let primaryInstrumentIds = primaryInstrumentIdsOverride
    ? [...primaryInstrumentIdsOverride]
    : candidate.primaryInstrumentIds;
  if (!primaryInstrumentIdsOverride && primaryInstrumentRefs) {
    const resolved: string[] = [];
    for (const reference of primaryInstrumentRefs) {
      const instrument = exactInstrument(reference, instruments);
      if (!instrument) {
        return { input: null, question: "primaryInstrumentIds" };
      }
      resolved.push(instrument.id);
    }
    primaryInstrumentIds = resolved;
  }
  if (
    primaryInstrumentIds?.some(
      (id) => !instruments.some((instrument) => instrument.id === id),
    )
  ) {
    return { input: null, question: "primaryInstrumentIds" };
  }
  if (primaryInstrumentIds && hasDuplicates(primaryInstrumentIds)) {
    return { input: null, question: "primaryInstrumentIds" };
  }
  if (
    candidate.comparisonCatalogIdentities &&
    hasDuplicates(candidate.comparisonCatalogIdentities)
  ) {
    return { input: null, question: "comparisonCatalogIdentities" };
  }

  return {
    input: assistantMarketActionInputSchema.parse({
      ...candidate,
      ...(primaryInstrumentIds ? { primaryInstrumentIds } : {}),
    }),
    question: null,
  };
}

export function nextMarketQuestion(
  values: AssistantMarketValues,
): AssistantMarketQuestion | null {
  if (!values.primaryInstrumentIds?.length) return "primaryInstrumentIds";
  if (values.comparisonCatalogIdentities === undefined) {
    return "comparisonCatalogIdentities";
  }
  if (!values.period) return "period";
  if (!values.scale) return "scale";
  if (!values.outputFormat) return "outputFormat";
  if (!values.contentLocale) return "contentLocale";
  return null;
}

export function selectionValues(
  input: AssistantMarketActionInput,
): AssistantMarketValues {
  return assistantMarketValuesSchema.parse({
    primaryInstrumentIds: input.primaryInstrumentIds,
    brandingInstrumentId: input.brandingInstrumentId,
    comparisonCatalogIdentities: input.comparisonCatalogIdentities,
    period: input.period,
    scale: input.scale,
    outputFormat: input.outputFormat,
    contentLocale: input.contentLocale,
  });
}

function exactInstrument(
  reference: string,
  instruments: readonly Instrument[],
): Instrument | null {
  const normalized = normalize(reference);
  const matches = instruments.filter((instrument) =>
    [instrument.id, instrument.key, instrument.symbol, instrument.name].some(
      (value) => normalize(value) === normalized,
    ),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function normalize(value: string) {
  return value.trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function hasDuplicates(values: readonly string[]) {
  return new Set(values).size !== values.length;
}

function sameSetup(
  current: AssistantMarketToolInput | undefined,
  patch: AssistantMarketToolInput,
) {
  return current?.action === "create" && patch.action === "create";
}

function definedMerge(left: object, right: object): Record<string, unknown> {
  const defined = Object.fromEntries(
    Object.entries(right).filter(([, value]) => value !== undefined),
  );
  return { ...left, ...defined };
}
