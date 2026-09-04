import { DIRECTION, UI_FONT } from "@rz-chain-reporter/i18n";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
} from "@rz-chain-reporter/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rz-chain-reporter/ui/components/collapsible";
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
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
} from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

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
        <ReportSection
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
        </ReportSection>
        <ReportSection
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
        </ReportSection>
      </div>
      <ReportSection
        action={<PublishingFreshness />}
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
      </ReportSection>
      <ReportProvenance core={core} dateTime={dateTime} t={t} />
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
    <ReportSection
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
      title={label}
    >
      <Suspended
        data={integrity}
        fallback={
          <Skeleton
            className="max-h-176 w-full rounded-lg"
            style={{ aspectRatio: `${media.width} / ${media.height}` }}
          />
        }
      >
        {(current) =>
          current === "available" ? (
            <Image
              alt={alt}
              className="h-auto max-h-176 w-full rounded-lg border object-contain"
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
      <div className="flex flex-wrap items-end justify-between gap-3">
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
              <div className="flex flex-wrap gap-2">
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
    </ReportSection>
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
    <ReportSection
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
    </ReportSection>
  );
}

function ReportProvenance({
  core,
  dateTime,
  t,
}: {
  core: ReportCore;
  dateTime: (value: Date) => string;
  t: Translate;
}) {
  const entries: readonly (readonly [string, string])[] = [
    [t("report.analysisId"), core.id],
    [t("report.requestFingerprint"), core.requestFingerprint],
    [t("report.snapshotId"), core.snapshot.id],
    [t("report.chartFingerprint"), core.chart.fingerprint],
    [t("report.renderContract"), core.chart.renderContractVersion],
    [t("report.chartChecksum"), core.chart.media.checksum],
    [t("report.storyFingerprint"), core.story.fingerprint],
    [t("report.designFingerprint"), core.design.fingerprint],
    [t("report.imageOption"), core.design.imageOptionKey],
    [t("report.referenceKey"), core.design.referenceSampleKey],
    [t("report.referenceChecksum"), core.design.referenceSampleChecksum],
    [t("report.lockupKey"), core.design.footerLockupKey],
    [t("report.lockupChecksum"), core.design.footerLockupChecksum],
    [t("report.posterFingerprint"), core.final.fingerprint],
    [t("report.posterChecksum"), core.final.media.checksum],
    [t("report.operationId"), core.final.operationId],
    [t("report.templateFingerprint"), core.fingerprints.template],
    [t("report.catalogFingerprint"), core.fingerprints.catalog ?? "—"],
    [t("report.profileFingerprint"), core.fingerprints.instrumentProfile],
    [
      t("report.approvedChartBy"),
      `${core.chart.approvedBy} · ${dateTime(core.chart.approvedAt)}`,
    ],
    [
      t("report.approvedStoryBy"),
      `${core.story.approvedBy} · ${dateTime(core.story.approvedAt)}`,
    ],
    [
      t("report.approvedDesignBy"),
      `${core.design.approvedBy} · ${dateTime(core.design.approvedAt)}`,
    ],
    [
      t("report.approvedPosterBy"),
      `${core.final.approvedBy} · ${dateTime(core.final.approvedAt)}`,
    ],
    [
      t("report.completedBy"),
      `${core.completedBy} · ${dateTime(core.completedAt)}`,
    ],
  ];
  const fallbackReason =
    core.final.fallbackCode === "MODEL_INVOCATION_FAILED" ||
    core.final.fallbackCode === "STRUCTURED_OUTPUT_INVALID"
      ? t(`generate.fallback.${core.final.fallbackCode}`)
      : t("generate.fallback.generic");
  return (
    <Collapsible className="rounded-xl border bg-card text-muted-foreground">
      <CollapsibleTrigger
        render={
          <Button
            className="group h-auto w-full justify-between whitespace-normal px-4 py-3 text-start"
            variant="ghost"
          />
        }
      >
        <span className="text-xs">{t("report.provenance")}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t p-4">
        <dl className="grid compact:grid-cols-2 wide:grid-cols-3 gap-3 text-xs">
          {entries.map(([label, value]) => (
            <Fact key={label} label={label}>
              <Bdi className="break-all font-mono font-normal">{value}</Bdi>
            </Fact>
          ))}
          <Fact label={t("report.briefSource")}>
            {core.final.briefSource
              ? t(`report.briefSources.${core.final.briefSource}`)
              : "—"}
          </Fact>
          {core.final.fallbackCode ? (
            <Fact label={t("report.fallbackReason")}>{fallbackReason}</Fact>
          ) : null}
          <Fact label={t("report.createdAt")}>
            <time dateTime={core.createdAt.toISOString()}>
              {dateTime(core.createdAt)}
            </time>
          </Fact>
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ReportSection({
  action,
  children,
  description,
  footer,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  footer?: string;
  title: string;
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <Card className="flex-1 gap-0 border ring-0">
        <CardHeader className="border-b bg-muted/30 py-4">
          <h2 className="font-medium text-sm">{title}</h2>
          {description ? (
            <p className="text-muted-foreground text-xs">{description}</p>
          ) : null}
          {action ? <CardAction>{action}</CardAction> : null}
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4 pt-4">
          {children}
        </CardContent>
        {footer ? (
          <CardFooter className="mt-4 text-muted-foreground text-xs">
            {footer}
          </CardFooter>
        ) : null}
      </Card>
    </section>
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
