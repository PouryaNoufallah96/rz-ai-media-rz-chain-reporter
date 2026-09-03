"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Locale } from "@rz-chain-reporter/i18n";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@rz-chain-reporter/ui/components/card";
import { useTranslations } from "next-intl";
import { useRef, useTransition } from "react";
import {
  FormProvider,
  useForm,
  useFormContext,
  useWatch,
} from "react-hook-form";

import { applyActionErrorToForm, useAction } from "@/hooks/use-action";
import { useRouter } from "@/i18n/navigation";
import { createMarketAnalysisAction } from "../actions/commands";
import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { useRememberedComparisons } from "../hooks/use-remembered-comparisons";
import { useMarketActionError } from "../lib/action-error";
import { configuredInstruments } from "../lib/market-request";
import {
  type MarketRequestSelectionInput,
  marketRequestSelectionSchema,
} from "../schemas/create";
import type {
  MarketAnalysisCatalogProjection,
  MarketAnalysisOptionsProjection,
  MarketComparisonProjection,
} from "../schemas/reads";
import { AnalysisWorkspaceFrame } from "./analysis-workspace-frame";
import { CurrentProjectSidebar } from "./current-project-sidebar";
import { continueAfterFetch, MarketSetupForm } from "./market-setup-form";

const ROOT_REACHABLE_STEPS = ["market"] as const;
const NO_COMPLETED_STEPS = new Set<"market">();

type Instrument = MarketAnalysisOptionsProjection["instruments"][number];

function useSubmissionKey() {
  const identity = useRef<{ fingerprint: string; key: string } | null>(null);
  return (fingerprint: string) => {
    if (identity.current?.fingerprint === fingerprint) {
      return identity.current.key;
    }
    const key = crypto.randomUUID();
    identity.current = { fingerprint, key };
    return key;
  };
}

export function MarketAnalysisEntry({
  catalog,
  initialContentLocale,
  options,
}: {
  catalog: MarketAnalysisCatalogProjection;
  initialContentLocale: Locale;
  options: MarketAnalysisOptionsProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const resolveError = useMarketActionError();
  const router = useRouter();
  const action = useAction(createMarketAnalysisAction);
  const [isNavigating, startNavigation] = useTransition();
  const submissionKey = useSubmissionKey();
  const { comparisons, remember } = useRememberedComparisons(catalog.entries);
  const instruments = configuredInstruments(options);
  const initialInstrument = instruments[0];
  const defaultComparison = catalog.entries.find(
    (entry) => entry.baseAsset === options.defaultComparisonSymbol,
  );
  const form = useForm<MarketRequestSelectionInput>({
    defaultValues: {
      primaryInstrumentIds: initialInstrument ? [initialInstrument.id] : [],
      brandingInstrumentId: initialInstrument?.id ?? "",
      comparisonCatalogIdentities: defaultComparison
        ? [defaultComparison.canonicalIdentity]
        : [],
      period: options.defaultPeriod,
      scale: options.defaultScale,
      outputFormat: options.outputFormat,
      contentLocale: initialContentLocale,
    },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: zodResolver(marketRequestSelectionSchema),
  });
  const {
    clearErrors,
    formState: { isSubmitting },
    handleSubmit,
    setError,
    setFocus,
  } = form;
  const pending = isSubmitting || action.isPending || isNavigating;

  const onSubmit = handleSubmit(async (values, event) => {
    clearErrors("root");
    action.reset();
    const result = await action.execute({
      ...values,
      idempotencyKey: submissionKey(JSON.stringify(values)),
    });
    if (result.status !== "success" || !result.data) {
      applyActionErrorToForm(setError, result, setFocus);
      return;
    }
    const pathname = `/market-analysis/${result.data.analysisId}`;
    const href = continueAfterFetch(event)
      ? { pathname, query: { step: "chart" } }
      : pathname;
    startNavigation(() => router.push(href, { scroll: false }));
  });

  if (!initialInstrument) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("create.unavailableTitle")}</CardTitle>
          <CardDescription>{t("create.unavailableBody")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <section
      aria-label={t("create.title")}
      className="flex min-w-0 flex-1 flex-col gap-4"
    >
      <FormProvider {...form}>
        <AnalysisWorkspaceFrame
          completed={NO_COMPLETED_STEPS}
          historyHref={{
            pathname: "/market-analysis",
            query: { view: "history" },
          }}
          description={t("create.pageDescription")}
          onStep={() => undefined}
          reachable={ROOT_REACHABLE_STEPS}
          selected="market"
          sidebar={
            <EntrySidebar
              comparisons={comparisons}
              instruments={instruments}
              pending={pending}
            />
          }
          title={t("create.title")}
        >
          <MarketSetupForm
            catalogReady={catalog.entries.length > 0}
            comparisons={comparisons}
            instruments={instruments}
            onRememberComparison={remember}
            onSubmit={onSubmit}
            options={options}
            pending={pending}
            resolveError={resolveError}
          />
        </AnalysisWorkspaceFrame>
      </FormProvider>
    </section>
  );
}

function EntrySidebar({
  comparisons,
  instruments,
  pending,
}: {
  comparisons: readonly MarketComparisonProjection[];
  instruments: readonly Instrument[];
  pending: boolean;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const { control } = useFormContext<MarketRequestSelectionInput>();
  const [
    primaryIds,
    brandingId,
    comparisonIds,
    period,
    scale,
    outputFormat,
    contentLocale,
  ] = useWatch({
    control,
    name: [
      "primaryInstrumentIds",
      "brandingInstrumentId",
      "comparisonCatalogIdentities",
      "period",
      "scale",
      "outputFormat",
      "contentLocale",
    ],
  });
  const primaryIdSet = new Set(primaryIds);
  const comparisonIdSet = new Set(comparisonIds);
  const selected = instruments.filter((instrument) =>
    primaryIdSet.has(instrument.id),
  );
  const owner = instruments.find((instrument) => instrument.id === brandingId);
  const status = pending ? "fetching" : "idle";
  return (
    <CurrentProjectSidebar
      comparisons={comparisons.flatMap((entry) =>
        comparisonIdSet.has(entry.canonicalIdentity) ? [entry.baseAsset] : [],
      )}
      contentLocale={contentLocale}
      icon={owner?.icon ?? null}
      outputFormat={outputFormat}
      owner={owner?.name ?? ""}
      period={period}
      primaries={selected.map((instrument) => instrument.name)}
      scale={scale}
      status={{
        label: t(`market.status.${status}`),
        state: status === "fetching" ? "running" : "queued",
      }}
    />
  );
}
