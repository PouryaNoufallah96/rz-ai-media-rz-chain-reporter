import { notFound } from "next/navigation";
import { MarketAnalysisScreen } from "@/features/market-analysis/components/market-analysis-screen";
import type { MarketAnalysisSearchParams } from "@/features/market-analysis/schemas/search";
import { customerTemplate } from "@/lib/customer-template.server";

export default function MarketAnalysisPage({
  searchParams,
}: {
  searchParams: MarketAnalysisSearchParams;
}) {
  if (!customerTemplate.marketAnalysis.enabled) notFound();
  return (
    <main id="main-content">
      <MarketAnalysisScreen searchParams={searchParams} />
    </main>
  );
}
