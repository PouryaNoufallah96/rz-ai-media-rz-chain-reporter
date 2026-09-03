import { notFound } from "next/navigation";
import { AnalysisScreen } from "@/features/market-analysis/components/analysis-screen";
import { customerTemplate } from "@/lib/customer-template.server";

export default function MarketAnalysisDetailPage({
  params,
  searchParams,
}: PageProps<"/[locale]/market-analysis/[analysisId]">) {
  if (!customerTemplate.marketAnalysis.enabled) notFound();
  return (
    <main id="main-content">
      <AnalysisScreen
        analysisId={params.then(({ analysisId }) => analysisId)}
        searchParams={searchParams}
      />
    </main>
  );
}
