import { Button } from "@rz-chain-reporter/ui/components/button";
import { PlusIcon } from "lucide-react";

import { Suspended } from "@/components/fetcher/suspended";
import { PageContainer } from "@/components/layout/page-container";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Localized } from "@/i18n/client";
import { Link } from "@/i18n/navigation";
import { currentLocale, getT } from "@/i18n/server";

import { getMarketAnalysisCatalog } from "../api/server/get-catalog";
import { getMarketAnalysisHistory } from "../api/server/get-history";
import { getMarketAnalysisOptions } from "../api/server/get-options";
import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import {
  loadMarketAnalysisSearchParams,
  loadMarketAnalysisViewSearchParams,
  type MarketAnalysisSearchParams,
  normalizeMarketAnalysisHistoryQuery,
} from "../schemas/search";
import { AnalysisFrameSkeleton } from "./analysis-workspace-frame";
import { MarketAnalysisEntry } from "./market-analysis-entry";
import { MarketAnalysisHistory } from "./market-analysis-history";

const WORKSPACE_FRAME =
  "mx-auto flex min-h-full w-full max-w-[100rem] flex-col px-4 py-5 sm:px-6 sm:py-6";

export async function MarketAnalysisScreen({
  searchParams,
}: {
  searchParams: MarketAnalysisSearchParams;
}) {
  const t = await getT(MARKET_ANALYSIS_NAMESPACE);

  return (
    <Localized namespaces={[SHARED_NAMESPACE, MARKET_ANALYSIS_NAMESPACE]}>
      <Suspended
        data={async () => {
          const [selected, options] = await Promise.all([
            loadMarketAnalysisViewSearchParams(searchParams),
            getMarketAnalysisOptions(),
          ]);
          if (selected.view !== "history") {
            const [catalog, contentLocale] = await Promise.all([
              getMarketAnalysisCatalog(),
              currentLocale(),
            ]);
            return {
              catalog,
              contentLocale,
              kind: "create" as const,
              options,
            };
          }
          const parsed = await loadMarketAnalysisSearchParams(searchParams);
          const history = await getMarketAnalysisHistory(
            normalizeMarketAnalysisHistoryQuery(parsed),
          );
          return { history, kind: "history" as const };
        }}
        fallback={
          <div className={WORKSPACE_FRAME}>
            <AnalysisFrameSkeleton />
          </div>
        }
      >
        {(result) =>
          result.kind === "create" ? (
            <div className={WORKSPACE_FRAME}>
              <MarketAnalysisEntry
                catalog={result.catalog}
                initialContentLocale={result.contentLocale}
                options={result.options}
              />
            </div>
          ) : (
            <PageContainer>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-balance font-semibold text-2xl tracking-display">
                    {t("title")}
                  </h1>
                  <p className="mt-2 max-w-3xl text-pretty text-muted-foreground text-sm/relaxed">
                    {t("history.description")}
                  </p>
                </div>
                <Button
                  nativeButton={false}
                  render={<Link href="/market-analysis" />}
                >
                  <PlusIcon aria-hidden="true" data-icon="inline-start" />
                  {t("actions.create")}
                </Button>
              </div>
              <MarketAnalysisHistory history={result.history} />
            </PageContainer>
          )
        }
      </Suspended>
    </Localized>
  );
}
