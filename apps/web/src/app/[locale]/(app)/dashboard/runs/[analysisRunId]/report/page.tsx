import { ReportScreen } from "./report-screen";

export default function RunReportPage(
  props: PageProps<"/[locale]/dashboard/runs/[analysisRunId]/report">,
) {
  return (
    <main id="main-content">
      <ReportScreen params={props.params} searchParams={props.searchParams} />
    </main>
  );
}
