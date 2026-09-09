import { DIRECTION, UI_FONT } from "@rz-chain-reporter/i18n";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Card, CardContent } from "@rz-chain-reporter/ui/components/card";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rz-chain-reporter/ui/components/table";
import {
  AlertTriangleIcon,
  DownloadIcon,
  ExternalLinkIcon,
} from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

import { SectionCard } from "@/components/common/section-card";
import { Suspended } from "@/components/fetcher/suspended";
import { PublishingFreshness } from "@/features/publishing/components/publishing-freshness";
import { currentLocale, getFormatter, getT } from "@/i18n/server";

import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { formatMarketAmount, formatMarketChange } from "../lib/format";
import {
  failureMessage,
  warningMessage,
  warningRecords,
} from "../lib/snapshot";
import type {
  MarketAnalysisReportCore,
  MarketAnalysisReportLive,
  MarketMediaIntegrity,
  ReportMedia,
} from "../schemas/reads";
import { ReportPublishing } from "./report-publishing";

type ReportCore = MarketAnalysisReportCore;
type ReportLive = MarketAnalysisReportLive;
type Translate = Awaited<
  ReturnType<typeof getT<typeof MARKET_ANALYSIS_NAMESPACE>>
>;
type Format = Awaited<ReturnType<typeof getFormatter>>;
type PublishingProps = Omit<Parameters<typeof ReportPublishing>[0], "handoffs">;

export async function MarketAnalysisReport({
  core,
  live,
  ...publishing
}: PublishingProps & {
  core: ReportCore;
  live: Promise<ReportLive>;
}) {
  const [t, format, locale] = await Promise.all([
    getT(MARKET_ANALYSIS_NAMESPACE),
    getFormatter(),
    currentLocale(),
  ]);
  const symbols = core.normalizedRequest.series
    .map((series) => series.symbol)
    .join(" / ");
  const dateTime = (value: Date) =>
    format.dateTime(value, { dateStyle: "medium", timeStyle: "short" });
  return (
    <article className="grid min-w-0 gap-4">
      <ReportHeader core={core} dateTime={dateTime} symbols={symbols} t={t} />
      <section
        aria-label={t("report.artifacts")}
        className="grid gap-4 xl:grid-cols-2"
      >
        <Artifact
          alt={t("report.posterAlt", { symbols, period: core.snapshot.period })}
          integrity={mediaIntegrity(live, "final", core.final.media.id)}
          label={t("report.finalPoster")}
          media={core.final.media}
          t={t}
        />
        <Artifact
          alt={t("report.chartAlt", { symbols, period: core.snapshot.period })}
          attribution={core.chart.attribution}
          integrity={mediaIntegrity(live, "chart", core.chart.media.id)}
          label={t("report.canonicalChart")}
          media={core.chart.media}
          spec={core.chart.spec}
          t={t}
        />
      </section>
      <MarketEvidence
        core={core}
        dateTime={dateTime}
        format={format}
        locale={locale}
        t={t}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          className="flex-1"
          content="stack"
          footer={t("report.approvedAt", {
            date: dateTime(core.story.approvedAt),
          })}
          title={t("report.approvedStory")}
        >
          <div
            dir={DIRECTION[core.contentLocale]}
            lang={core.contentLocale}
            style={{ fontFamily: UI_FONT[core.contentLocale] }}
          >
            <h3 className="font-semibold text-lg">{core.story.headline}</h3>
            <p className="mt-2 text-muted-foreground text-sm">
              {core.story.supportingText}
            </p>
          </div>
        </SectionCard>
        <SectionCard
          className="flex-1"
          content="stack"
          footer={t("report.approvedAt", {
            date: dateTime(core.design.approvedAt),
          })}
          title={t("report.approvedDesign")}
        >
          <dl className="grid compact:grid-cols-2 gap-3 text-sm">
            <Fact label={t("report.family")}>
              <Bdi>{core.design.familyLabel ?? core.design.familyKey}</Bdi>
            </Fact>
            <Fact label={t("report.variant")}>
              <Bdi>{core.design.variantLabel ?? core.design.variantKey}</Bdi>
            </Fact>
            <Fact label={t("report.format")}>
              {t(`design.formats.${core.design.outputFormat}`)}
            </Fact>
            <Fact label={t("report.reference")}>
              <Bdi>
                {core.design.referenceSampleLabel ??
                  t("report.referenceUnavailable")}
              </Bdi>
            </Fact>
          </dl>
        </SectionCard>
      </div>
      <SectionCard
        action={<PublishingFreshness />}
        className="flex-1"
        content="stack"
        description={t("report.handoffsBody")}
        title={t("report.handoffs")}
      >
        <Suspended
          data={live}
          fallback={<PublishingSkeleton loadingLabel={t("shell.loading")} />}
        >
          {(current) => (
            <ReportPublishing handoffs={current.handoffs} {...publishing} />
          )}
        </Suspended>
      </SectionCard>
    </article>
  );
}

function ReportHeader({
  core,
  dateTime,
  symbols,
  t,
}: {
  core: ReportCore;
  dateTime: (value: Date) => string;
  symbols: string;
  t: Translate;
}) {
  return (
    <header>
      <Card className="border ring-0">
        <CardContent className="grid gap-4">
          <div>
            <h1 className="flex flex-wrap items-baseline gap-x-2 font-semibold text-2xl tracking-display sm:text-3xl">
              <Bdi>{symbols}</Bdi>
              <span aria-hidden="true">·</span>
              <span>
                {t(`create.periods.${core.normalizedRequest.period}`)}
              </span>
            </h1>
            <p className="mt-1 max-w-3xl text-muted-foreground text-sm">
              {t("report.summary")}
            </p>
          </div>
          <dl className="grid compact:grid-cols-3 gap-3 border-t pt-4 text-sm">
            <Fact label={t("report.completed")}>
              <time dateTime={core.completedAt.toISOString()}>
                {dateTime(core.completedAt)}
              </time>
            </Fact>
            <Fact label={t("report.contentLocale")}>
              {t(`create.locales.${core.contentLocale}`)}
            </Fact>
            <Fact label={t("create.scale")}>
              {t(`create.scales.${core.normalizedRequest.scale}`)}
            </Fact>
          </dl>
        </CardContent>
      </Card>
    </header>
  );
}

function Artifact({
  alt,
  attribution,
  integrity,
  label,
  media,
  spec,
  t,
}: {
  alt: string;
  attribution?: readonly string[];
  integrity: Promise<MarketMediaIntegrity>;
  label: string;
  media: ReportMedia;
  spec?: ReportCore["chart"]["spec"];
  t: Translate;
}) {
  const href = `/api/media/${media.id}`;
  return (
    <SectionCard
      action={
        <Suspended
          data={integrity}
          fallback={<Skeleton className="h-5 w-20" />}
        >
          {(current) => (
            <Badge variant="outline">{t(`report.integrity.${current}`)}</Badge>
          )}
        </Suspended>
      }
      className="flex-1"
      content="stack"
      footer={
        <div className="grid w-full gap-3">
          <dl className="grid compact:grid-cols-2 gap-3 text-xs">
            <Fact label={t("report.dimensions")}>
              <Bdi>
                {media.width} × {media.height}
              </Bdi>
            </Fact>
            <Fact label={t("report.fileType")}>
              <Bdi dir="ltr">{media.mimeType}</Bdi>
            </Fact>
            {attribution && attribution.length > 0 ? (
              <Fact label={t("report.attribution")}>
                <Bdi dir="ltr">{attribution.join(" · ")}</Bdi>
              </Fact>
            ) : null}
            {spec ? (
              <>
                <Fact label={t("chart.legendPosition")}>
                  {t(`chart.legendPositions.${spec.legendPosition}`)}
                </Fact>
                <Fact label={t("chart.legendFormat")}>
                  {t(`chart.legendFormats.${spec.legendFormat}`)}
                </Fact>
                <Fact label={t("chart.lineWidth")}>
                  {t("chart.lineWidthValue", { value: spec.lineWidth })}
                </Fact>
                <Fact label={t("chart.markers")}>
                  {t(`chart.markerOptions.${spec.markers}`)}
                </Fact>
                <Fact label={t("chart.gridStrength")}>
                  {t(`chart.gridStrengths.${spec.gridStrength}`)}
                </Fact>
              </>
            ) : null}
          </dl>
          <Suspended data={integrity} fallback={null}>
            {(current) =>
              current === "available" ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    nativeButton={false}
                    render={
                      <a href={href} rel="noreferrer" target="_blank">
                        <ExternalLinkIcon
                          aria-hidden="true"
                          data-icon="inline-start"
                        />
                        {t("report.view")}
                      </a>
                    }
                    size="sm"
                    variant="outline"
                  />
                  <Button
                    nativeButton={false}
                    render={
                      <a href={`${href}?download=1`}>
                        <DownloadIcon
                          aria-hidden="true"
                          data-icon="inline-start"
                        />
                        {t("report.download")}
                      </a>
                    }
                    size="sm"
                    variant="outline"
                  />
                </div>
              ) : null
            }
          </Suspended>
        </div>
      }
      title={label}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Suspended
          data={integrity}
          fallback={
            <Skeleton
              className="max-h-112 max-w-full rounded-lg"
              style={{ aspectRatio: `${media.width} / ${media.height}` }}
            />
          }
        >
          {(current) =>
            current === "available" ? (
              <Image
                alt={alt}
                className="h-auto max-h-112 w-auto max-w-full rounded-lg border object-contain"
                height={media.height}
                loading="eager"
                src={href}
                unoptimized
                width={media.width}
              />
            ) : (
              <p className="text-muted-foreground text-xs">
                {t(`report.integrityBody.${current}`)}
              </p>
            )
          }
        </Suspended>
      </div>
    </SectionCard>
  );
}

function MarketEvidence({
  core,
  dateTime,
  format,
  locale,
  t,
}: {
  core: ReportCore;
  dateTime: (value: Date) => string;
  format: Format;
  locale: Awaited<ReturnType<typeof currentLocale>>;
  t: Translate;
}) {
  const warnings = warningRecords(core.snapshot.id, core.snapshot.warnings);
  const columns = [
    "series",
    "provider",
    "window",
    "start",
    "end",
    "change",
    "state",
  ] as const;
  return (
    <SectionCard
      className="flex-1"
      content="stack"
      description={t("report.marketWindow", {
        status: t(`report.snapshotStatus.${core.snapshot.status}`),
        scale: t(`create.scales.${core.normalizedRequest.scale}`),
        verified: dateTime(core.snapshot.fetchCompletedAt),
        window: coverageWindow(
          core.snapshot.effectiveWindowStart,
          core.snapshot.effectiveWindowEnd,
          format,
        ),
      })}
      title={t("report.marketEvidence")}
    >
      {warnings.length > 0 ? (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>{t("market.snapshotWarnings")}</AlertTitle>
          <AlertDescription>
            <ul className="grid gap-1">
              {warnings.map((warning) => (
                <li key={warning.key}>{warningMessage(t, warning.code)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-hidden rounded-lg border">
        <Table className="min-w-208">
          <TableCaption className="sr-only">
            {t("report.factsCaption")}
          </TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((key) => (
                <TableHead key={key}>{t(`report.columns.${key}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {core.snapshot.series.map((series) => (
              <TableRow key={series.descriptorIdentity}>
                <TableCell>
                  <Bdi>{seriesLabel(core, series.descriptorIdentity)}</Bdi>
                </TableCell>
                <TableCell>
                  <Bdi dir="ltr">{series.provider ?? "—"}</Bdi>
                  {series.providerReference ? (
                    <Bdi
                      className="block break-all font-mono text-muted-foreground text-xs"
                      dir="ltr"
                    >
                      {series.providerReference}
                    </Bdi>
                  ) : null}
                </TableCell>
                <TableCell>
                  {coverageWindow(
                    series.coverageStart,
                    series.coverageEnd,
                    format,
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  <Bdi>{formatMarketAmount(series.startPrice, locale)}</Bdi>
                </TableCell>
                <TableCell className="tabular-nums">
                  <Bdi>{formatMarketAmount(series.endPrice, locale)}</Bdi>
                </TableCell>
                <TableCell className="tabular-nums">
                  <Bdi>{formatMarketChange(series.changePercent, locale)}</Bdi>
                </TableCell>
                <TableCell>
                  {t(`report.seriesState.${series.outcome}`)}
                  {series.outcome === "succeeded" ? null : (
                    <span className="block text-muted-foreground text-xs">
                      {failureMessage(t, series.failureCode)}
                    </span>
                  )}
                  {series.warnings.length > 0 ? (
                    <ul className="mt-1 grid gap-1 text-muted-foreground text-xs">
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SectionCard>
  );
}

function Fact({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="ticket-label text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium">{children}</dd>
    </div>
  );
}

function seriesLabel(core: ReportCore, descriptorIdentity: string) {
  const descriptor = core.normalizedRequest.series.find(
    (series) => series.descriptorIdentity === descriptorIdentity,
  );
  return descriptor ? `${descriptor.displayName} (${descriptor.symbol})` : "—";
}

async function mediaIntegrity(
  live: Promise<ReportLive>,
  role: "chart" | "final",
  id: string,
): Promise<MarketMediaIntegrity> {
  const { media } = await live;
  return (
    media.find((item) => item.role === role && item.id === id)?.integrity ??
    "reconciliation_required"
  );
}

function coverageWindow(start: Date | null, end: Date | null, format: Format) {
  if (!start || !end) return "—";
  const options = { dateStyle: "short", timeStyle: "short" } as const;
  return `${format.dateTime(start, options)} – ${format.dateTime(end, options)}`;
}

function PublishingSkeleton({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div aria-busy="true" className="grid gap-3" role="status">
      <span className="sr-only">{loadingLabel}</span>
      {[0, 1].map((item) => (
        <Skeleton className="h-12 w-full rounded-lg" key={item} />
      ))}
    </div>
  );
}
