import { ReportScreen } from "./report-screen";

export default function RunReportPage(
  props: PageProps<"/[locale]/dashboard/runs/[analysisRunId]/report">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10" id="main-content">
      <ReportScreen params={props.params} searchParams={props.searchParams} />
    </main>
  );
}
