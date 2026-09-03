"use client";

import type { Locale } from "@rz-chain-reporter/i18n";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Card, CardContent } from "@rz-chain-reporter/ui/components/card";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalTrigger,
} from "@rz-chain-reporter/ui/components/responsive-modal";
import { AlertTriangleIcon, CheckIcon, InfoIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { StateMark } from "@/components/common/state-mark";

import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { formatMarketAmount, formatMarketChange } from "../lib/format";
import {
  descriptorOf,
  failureMessage,
  warningMessage,
  warningRecords,
} from "../lib/snapshot";
import type {
  MarketAnalysisProjection,
  MarketSnapshotProjection,
} from "../schemas/reads";

export function MarketSnapshotDetail({
  analysis,
}: {
  analysis: MarketAnalysisProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const snapshot =
    analysis.currentSnapshot ?? analysis.verification?.resultSnapshot ?? null;
  if (!snapshot) return null;
  return (
    <ResponsiveModal>
      <ResponsiveModalTrigger
        render={
          <Button
            className="w-full justify-start"
            type="button"
            variant="outline"
          />
        }
      >
        <InfoIcon aria-hidden="true" data-icon="inline-start" />
        {t("market.detailTitle")}
      </ResponsiveModalTrigger>
      <ResponsiveModalContent className="max-w-2xl">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t("market.detailTitle")}</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            {t("market.detailDescription")}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <div className="max-h-[60vh] overflow-y-auto p-px">
          <SnapshotDetail analysis={analysis} snapshot={snapshot} />
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

function SnapshotDetail({
  analysis,
  snapshot,
}: {
  analysis: MarketAnalysisProjection;
  snapshot: MarketSnapshotProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const locale = useLocale();
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-sm">
        <StateMark state={snapshotState(snapshot.status)} />
        <span className="font-medium">
          {t(`market.snapshotStatus.${snapshot.status}`)}
        </span>
      </div>
      {snapshot.warnings.length > 0 ? (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>{t("market.snapshotWarnings")}</AlertTitle>
          <AlertDescription>
            <ul className="grid gap-1">
              {warningRecords(snapshot.id, snapshot.warnings).map((warning) => (
                <li key={warning.key}>{warningMessage(t, warning.code)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {snapshot.series.map((series) => {
          const descriptor = descriptorOf(analysis, series.descriptorIdentity);
          return (
            <Card key={series.descriptorIdentity} size="sm">
              <CardContent className="grid gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {descriptor?.displayName ?? series.descriptorIdentity}
                    </p>
                    <Bdi className="text-muted-foreground text-xs">
                      {descriptor?.symbol ?? series.descriptorIdentity}
                    </Bdi>
                  </div>
                  <Badge
                    variant={
                      series.outcome === "succeeded" ? "outline" : "destructive"
                    }
                  >
                    {series.outcome === "succeeded" ? (
                      <CheckIcon aria-hidden="true" data-icon="inline-start" />
                    ) : (
                      <AlertTriangleIcon
                        aria-hidden="true"
                        data-icon="inline-start"
                      />
                    )}
                    {t(`market.series.${series.outcome}`)}
                  </Badge>
                </div>
                {series.outcome === "succeeded" ? (
                  <dl className="grid grid-cols-3 gap-3 text-sm">
                    <Metric
                      label={t("market.start")}
                      locale={locale}
                      value={series.startPrice}
                    />
                    <Metric
                      label={t("market.end")}
                      locale={locale}
                      value={series.endPrice}
                    />
                    <Metric
                      label={t("market.change")}
                      locale={locale}
                      percent
                      value={series.changePercent}
                    />
                  </dl>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {failureMessage(t, series.failureCode)}
                  </p>
                )}
                {series.warnings.length > 0 ? (
                  <ul className="grid gap-1 text-muted-foreground text-xs">
                    {warningRecords(
                      series.descriptorIdentity,
                      series.warnings,
                    ).map((warning) => (
                      <li key={warning.key}>
                        {warningMessage(t, warning.code)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function snapshotState(status: MarketSnapshotProjection["status"]) {
  if (status === "verified") return "succeeded" as const;
  if (status === "partial") return "partial" as const;
  return "failed" as const;
}

function Metric({
  label,
  locale,
  percent = false,
  value,
}: {
  label: string;
  locale: Locale;
  percent?: boolean;
  value: string | null;
}) {
  const formatted = percent
    ? formatMarketChange(value, locale)
    : formatMarketAmount(value, locale);
  return (
    <div className="grid gap-1">
      <dt className="ticket-label text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">
        <Bdi>{formatted}</Bdi>
      </dd>
    </div>
  );
}
