"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { AlertTriangleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { applyActionErrorToForm, useAction } from "@/hooks/use-action";

import {
  updateMarketRequestAction,
  verifyMarketAnalysisAction,
} from "../actions/commands";
import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { useRememberedComparisons } from "../hooks/use-remembered-comparisons";
import { useMarketActionError } from "../lib/action-error";
import {
  comparisonsFromRequest,
  configuredInstruments,
  marketSetupStatus,
  mergeComparisons,
} from "../lib/market-request";
import {
  descriptorOf,
  failureMessage,
  warningMessage,
  warningRecords,
} from "../lib/snapshot";
import type { MarketRequestSelectionInput } from "../schemas/create";
import { marketRequestSelectionSchema } from "../schemas/create";
import type {
  MarketAnalysisCatalogProjection,
  MarketAnalysisOptionsProjection,
  MarketAnalysisProjection,
} from "../schemas/reads";
import { continueAfterFetch, MarketSetupForm } from "./market-setup-form";

export function MarketWorkspace({
  analysis,
  catalog,
  continueWhenVerified,
  onBack,
  onContinue,
  options,
}: {
  analysis: MarketAnalysisProjection;
  catalog: MarketAnalysisCatalogProjection;
  continueWhenVerified: boolean;
  onBack?: () => void;
  onContinue: () => void;
  options: MarketAnalysisOptionsProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const resolveError = useMarketActionError();
  const update = useAction(updateMarketRequestAction);
  const verify = useAction(verifyMarketAnalysisAction);
  const { comparisons, remember } = useRememberedComparisons(
    mergeComparisons(
      catalog.entries,
      comparisonsFromRequest(analysis.normalizedRequest),
    ),
  );
  const [awaitedSnapshotId, setAwaitedSnapshotId] = useState<
    string | null | undefined
  >(() =>
    continueWhenVerified &&
    !analysis.currentSnapshot &&
    marketSetupStatus(analysis) === "fetching"
      ? null
      : undefined,
  );
  const advanced = useRef(false);
  const instruments = configuredInstruments(options);
  const form = useForm<MarketRequestSelectionInput>({
    defaultValues: setupDefaults(analysis, options),
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: zodResolver(marketRequestSelectionSchema),
  });
  const {
    clearErrors,
    formState: { isSubmitting },
    handleSubmit,
    reset,
    setError,
    setFocus,
  } = form;
  const pending = isSubmitting || update.isPending || verify.isPending;
  const status = marketSetupStatus(analysis, pending);
  const working = status === "fetching";
  const snapshot = analysis.currentSnapshot ?? null;
  const verificationResult = analysis.verification?.resultSnapshot ?? null;
  const lifecycle = analysis.verification?.lifecycle;
  const failedSeries = ((snapshot ?? verificationResult)?.series ?? []).filter(
    (series) => series.outcome === "failed",
  );
  const refreshFailed =
    snapshot !== null &&
    (lifecycle === "failed" ||
      lifecycle === "cancelled" ||
      lifecycle === "unknown" ||
      (verificationResult?.status === "unverified" &&
        verificationResult.id !== snapshot.id));

  useEffect(() => {
    if (awaitedSnapshotId === undefined || advanced.current) return;
    if (snapshot?.status !== "verified" || snapshot.id === awaitedSnapshotId) {
      return;
    }
    advanced.current = true;
    onContinue();
  }, [awaitedSnapshotId, onContinue, snapshot]);

  const onSubmit = handleSubmit(async (values, event) => {
    clearErrors("root");
    update.reset();
    verify.reset();
    const saved = await update.execute({
      analysisId: analysis.id,
      expectedVersion: analysis.version,
      ...values,
    });
    if (saved.status !== "success" || !saved.data) {
      applyActionErrorToForm(setError, saved, setFocus);
      return;
    }
    const started = await verify.execute({
      analysisId: analysis.id,
      expectedVersion: saved.data.version,
      idempotencyKey: crypto.randomUUID(),
    });
    if (started.status !== "success") {
      applyActionErrorToForm(setError, started, setFocus);
      return;
    }
    reset(values);
    setAwaitedSnapshotId(
      continueAfterFetch(event) ? (snapshot?.id ?? null) : undefined,
    );
  });

  return (
    <FormProvider {...form}>
      <MarketSetupForm
        catalogReady={catalog.entries.length > 0}
        comparisons={comparisons}
        instruments={instruments}
        onBack={onBack}
        onRememberComparison={remember}
        onSubmit={onSubmit}
        options={options}
        pending={working}
        resolveError={resolveError}
      >
        <p aria-live="polite" className="sr-only">
          {t(`market.status.${status}`)}
        </p>
        {refreshFailed ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("market.lifecycle.failed")}</AlertTitle>
            <AlertDescription>{t("market.refreshFailedBody")}</AlertDescription>
          </Alert>
        ) : null}
        {failedSeries.length > 0 ? (
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>{t("market.seriesFailedTitle")}</AlertTitle>
            <AlertDescription className="grid gap-2">
              <ul className="grid gap-2">
                {failedSeries.map((series) => (
                  <li className="grid gap-0.5" key={series.descriptorIdentity}>
                    <span className="font-medium text-foreground">
                      <Bdi>
                        {descriptorOf(analysis, series.descriptorIdentity)
                          ?.displayName ?? series.descriptorIdentity}
                      </Bdi>
                    </span>
                    <span>{failureMessage(t, series.failureCode)}</span>
                    {warningRecords(
                      series.descriptorIdentity,
                      series.warnings,
                    ).map((warning) => (
                      <span key={warning.key}>
                        {warningMessage(t, warning.code)}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
              <p>{t("market.seriesFailedRetry")}</p>
            </AlertDescription>
          </Alert>
        ) : null}
      </MarketSetupForm>
    </FormProvider>
  );
}

function setupDefaults(
  analysis: MarketAnalysisProjection,
  options: MarketAnalysisOptionsProjection,
): MarketRequestSelectionInput {
  const request = analysis.normalizedRequest;
  return {
    primaryInstrumentIds: request.series.flatMap((series) =>
      series.role === "primary" && series.controlledInstrumentId
        ? [series.controlledInstrumentId]
        : [],
    ),
    brandingInstrumentId: analysis.visualOwnerInstrumentId,
    comparisonCatalogIdentities: request.series.flatMap((series) =>
      series.role === "comparison" ? [series.descriptorIdentity] : [],
    ),
    period: request.period,
    scale: request.scale,
    outputFormat: analysis.outputFormat ?? options.outputFormat,
    contentLocale: analysis.contentLocale,
  };
}
