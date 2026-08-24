import type { AnalysisRunProgress } from "@rz-chain-reporter/db/repositories/analysis-run";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DataTableSkeleton } from "@/components/data-table/skeleton";
import { Suspended } from "@/components/fetcher/suspended";
import { getEditorialWorkspace } from "@/features/editorial/api/server/get-editorial-workspace";
import { getRunReport } from "@/features/editorial/api/server/get-run-report";
import { FunnelBlock } from "@/features/editorial/components/funnel-block";
import {
  MutedTag,
  ProvenanceLine,
} from "@/features/editorial/components/provenance-line";
import { ReportTable } from "@/features/editorial/components/report-table";
import { EDITORIAL_NAMESPACE } from "@/features/editorial/constants";
import type { ReportSearchParams } from "@/features/editorial/schemas/report";
import { Localized } from "@/i18n/client";
import { Link } from "@/i18n/navigation";
import { getFormatter, getT } from "@/i18n/server";

const REPORT_COLUMN_COUNT = 8;

// Server module: the slice's `SHORT_ID_LENGTH` lives in the client-only
// `run-selector`, whose exports reach a Server Component as client references.
const SHORT_ID_LENGTH = 8;

type Translate = Awaited<ReturnType<typeof getT<typeof EDITORIAL_NAMESPACE>>>;
type Format = Awaited<ReturnType<typeof getFormatter>>;

export function ReportScreen({
  params,
  searchParams,
}: {
  params: Promise<{ analysisRunId: string }>;
  searchParams: ReportSearchParams;
}) {
  return (
    <Suspended
      data={() => Promise.all([getT(EDITORIAL_NAMESPACE), getFormatter()])}
      fallback={<ReportHeadingSkeleton />}
    >
      {([t, format]) => (
        <>
          <h1 className="mt-2 font-semibold text-3xl">{t("report.title")}</h1>
          <Suspended
            data={() => readReport(params, searchParams)}
            fallback={<ReportBodySkeleton label={t("table.loading")} />}
          >
            {({ head, funnels, report }) => (
              <>
                <ProvenanceLine
                  segments={[
                    t("provenance.run", {
                      id: head.id.slice(0, SHORT_ID_LENGTH),
                    }),
                    t("provenance.template", {
                      fingerprint: head.templateFingerprint.slice(
                        0,
                        SHORT_ID_LENGTH,
                      ),
                    }),
                    ...(head.configuration.kind === "news"
                      ? [
                          t("provenance.topN", {
                            n: head.configuration.topN,
                          }),
                        ]
                      : []),
                    format.dateTime(head.startedAt, {
                      dateStyle: "short",
                      timeStyle: "short",
                    }),
                  ]}
                >
                  {head.templateChanged ? (
                    <MutedTag>{t("run.templateChanged.tag")}</MutedTag>
                  ) : null}
                </ProvenanceLine>
                <Button
                  className="mt-3 ps-0"
                  nativeButton={false}
                  render={<Link href={`/dashboard?run=${head.id}`} />}
                  size="sm"
                  variant="link"
                >
                  {t("report.back")}
                </Button>
                <div className="mt-6 grid gap-6 min-[1200px]:grid-cols-3 min-[600px]:grid-cols-2">
                  <FunnelBlock
                    lines={itemFunnel(funnels, format, t)}
                    title={t("funnel.item.title")}
                  />
                  <FunnelBlock
                    lines={routeFunnel(funnels, format, t)}
                    title={t("funnel.route.title")}
                  />
                  <div className="min-[900px]:max-[1199px]:col-span-2">
                    <FunnelBlock
                      lines={modelFunnel(funnels, format, t)}
                      title={t("funnel.model.title")}
                    />
                  </div>
                </div>
                <Localized namespaces={[EDITORIAL_NAMESPACE]}>
                  <ReportTable head={head} report={report} />
                </Localized>
              </>
            )}
          </Suspended>
        </>
      )}
    </Suspended>
  );
}

async function readReport(
  params: Promise<{ analysisRunId: string }>,
  searchParams: ReportSearchParams,
) {
  const { analysisRunId } = await params;

  if (!z.uuid().safeParse(analysisRunId).success) {
    notFound();
  }

  const [report, workspace] = await Promise.all([
    getRunReport(analysisRunId, searchParams),
    getEditorialWorkspace(Promise.resolve({ run: analysisRunId })),
  ]);

  if (!workspace.head || !report.funnels) {
    notFound();
  }

  return { funnels: report.funnels, head: workspace.head, report };
}

function ReportHeadingSkeleton() {
  return <Skeleton className="mt-2 h-9 w-64" />;
}

function ReportBodySkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true">
      <Skeleton className="mt-3 h-4 w-full max-w-md" />
      <div className="mt-6 grid gap-6 min-[1200px]:grid-cols-3 min-[600px]:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
      <div className="mt-10">
        <DataTableSkeleton
          columnCount={REPORT_COLUMN_COUNT}
          labels={{ loading: label }}
        />
      </div>
    </div>
  );
}

function itemFunnel(
  { items }: AnalysisRunProgress,
  format: Format,
  t: Translate,
) {
  return [
    { label: t("funnel.item.fetched"), value: format.number(items.fetched) },
    {
      label: t("funnel.item.dated"),
      value: format.number(items.datedInWindow),
    },
    { label: t("funnel.item.unique"), value: format.number(items.unique) },
    { label: t("funnel.item.admitted"), value: format.number(items.admitted) },
    {
      label: t("funnel.item.passedPolicy"),
      value: format.number(items.passedPolicy),
    },
    {
      label: t("funnel.item.inLane"),
      value: format.number(items.inOutputLane),
    },
  ];
}

function routeFunnel(
  { brandRoutes }: AnalysisRunProgress,
  format: Format,
  t: Translate,
) {
  return [
    {
      label: t("funnel.route.rssShortlisted"),
      value: format.number(brandRoutes.shortlisted),
    },
    {
      label: t("funnel.route.telegramLane"),
      value: format.number(brandRoutes.telegram_lane),
    },
    {
      label: t("funnel.route.capExceeded"),
      value: format.number(brandRoutes.cap_exceeded),
    },
    {
      label: t("funnel.route.noMediaFit"),
      value: format.number(brandRoutes.no_media_fit),
    },
    {
      label: t("funnel.route.lowScore"),
      value: format.number(brandRoutes.low_score),
    },
  ];
}

function modelFunnel(
  funnels: AnalysisRunProgress,
  format: Format,
  t: Translate,
) {
  const { units } = funnels;

  return [
    {
      label: t("funnel.model.units"),
      value: format.number(
        units.pending +
          units.running +
          units.succeeded +
          units.failed +
          units.cancelled,
      ),
    },
    {
      label: t("funnel.model.succeeded"),
      value: format.number(units.succeeded),
    },
    { label: t("funnel.model.failed"), value: format.number(units.failed) },
    {
      label: t("funnel.model.cancelled"),
      value: format.number(units.cancelled),
    },
    {
      label: t("funnel.model.selections"),
      value: format.number(funnels.selections),
    },
    {
      label: t("funnel.model.telegramCandidates"),
      value: t("funnel.model.zeroUnits", {
        n: funnels.brandRoutes.telegram_lane,
      }),
    },
  ];
}
