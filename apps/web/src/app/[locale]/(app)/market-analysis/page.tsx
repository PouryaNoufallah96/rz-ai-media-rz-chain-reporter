import { notFound } from "next/navigation";
import { MarketAnalysisScreen } from "@/features/market-analysis/components/market-analysis-screen";
import { customerTemplate } from "@/lib/customer-template.server";

export default function MarketAnalysisPage(
  props: PageProps<"/[locale]/market-analysis">,
) {
  if (!customerTemplate.marketAnalysis.enabled) notFound();
  return (
    <main id="main-content" tabIndex={-1}>
      <MarketAnalysisScreen searchParams={props.searchParams} />
    </main>
  );
}
