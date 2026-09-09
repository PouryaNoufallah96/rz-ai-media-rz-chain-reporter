import { notFound } from "next/navigation";
import { z } from "zod";

import { Suspended } from "@/components/fetcher/suspended";
import { PageDesk } from "@/components/layout/page-container";
import { getPlatformDraft } from "@/features/editorial/api/server/get-platform-draft";
import { EDITORIAL_NAMESPACE } from "@/features/editorial/constants";
import { PUBLISHING_NAMESPACE } from "@/features/publishing/constants";
import { Localized } from "@/i18n/client";
import { redirect } from "@/i18n/navigation";
import { currentLocale } from "@/i18n/server";
import {
  customerEditorial,
  enabledImageModels,
} from "@/lib/customer-template.server";

import { getMarketAnalysis } from "../api/server/get-analysis";
import { getMarketAnalysisCatalog } from "../api/server/get-catalog";
import { getMarketAnalysisOptions } from "../api/server/get-options";
import { getMarketAnalysisReport } from "../api/server/get-report";
import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import {
  loadAnalysisReportSearchParams,
  type MarketAnalysisSearchParams,
  normalizeAnalysisReportQuery,
} from "../schemas/search";
import { AnalysisWorkspace } from "./analysis-workspace";
import { AnalysisFrameSkeleton } from "./analysis-workspace-frame";
import { MarketAnalysisReport } from "./market-analysis-report";

const NAMESPACES = [
  MARKET_ANALYSIS_NAMESPACE,
  EDITORIAL_NAMESPACE,
  PUBLISHING_NAMESPACE,
] as const;

export function AnalysisScreen({
  analysisId,
  searchParams,
}: {
  analysisId: Promise<string>;
  searchParams: MarketAnalysisSearchParams;
}) {
  return (
    <PageDesk>
      <Localized namespaces={[MARKET_ANALYSIS_NAMESPACE]}>
        <Suspended
          data={() => readAnalysisView(analysisId, searchParams)}
          fallback={<AnalysisFrameSkeleton />}
        >
          {(view) => (
            <Localized namespaces={NAMESPACES}>
              {view.report ? (
                <MarketAnalysisReport {...view.report} />
              ) : (
                <AnalysisWorkspace
                  analysis={view.workspace.analysis}
                  catalog={view.workspace.catalog}
                  options={view.workspace.options}
                />
              )}
            </Localized>
          )}
        </Suspended>
      </Localized>
    </PageDesk>
  );
}

async function readAnalysisView(
  analysisId: Promise<string>,
  searchParams: MarketAnalysisSearchParams,
) {
  const id = await analysisId;
  if (!z.uuid().safeParse(id).success) notFound();
  const [report, analysis, catalog, options] = await Promise.all([
    getMarketAnalysisReport(id),
    getMarketAnalysis(id),
    getMarketAnalysisCatalog(),
    getMarketAnalysisOptions(),
  ]);
  if (report) {
    const raw = await searchParams;
    const query = normalizeAnalysisReportQuery(
      await loadAnalysisReportSearchParams(searchParams),
    );
    const draft = query.draft ? await getPlatformDraft(query.draft) : null;
    const selectedDraft =
      draft?.executionScope.kind === "market_analysis" &&
      draft.executionScope.marketAnalysisId === id
        ? draft
        : null;
    if (raw.step !== undefined || (raw.draft !== undefined && !selectedDraft)) {
      redirect({
        href: {
          pathname: `/market-analysis/${id}`,
          query: selectedDraft ? { draft: selectedDraft.card.id } : {},
        },
        locale: await currentLocale(),
      });
    }
    return {
      report: {
        ...report,
        analysisId: id,
        selectedDraft,
        query,
        models: customerEditorial.models,
        imageModels: enabledImageModels,
        copyModels: options.copyModels,
        defaultCopyModelOptionKey: options.defaultCopyModelOptionKey,
        platforms: customerEditorial.drafting.copy.platforms.map(
          ({ platform }) => platform,
        ),
      },
      workspace: null,
    };
  }
  if (!analysis || analysis.status === "completed") notFound();
  return { report: null, workspace: { analysis, catalog, options } };
}
