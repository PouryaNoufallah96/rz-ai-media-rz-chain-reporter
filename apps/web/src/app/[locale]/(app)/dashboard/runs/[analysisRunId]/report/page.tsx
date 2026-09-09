import { PageMain } from "@/components/layout/page-container";
import { ReportScreen } from "@/features/editorial/components/report-screen";

export default function RunReportPage(
  props: PageProps<"/[locale]/dashboard/runs/[analysisRunId]/report">,
) {
  return (
    <PageMain>
      <ReportScreen params={props.params} searchParams={props.searchParams} />
    </PageMain>
  );
}
