import { ReportScreen } from "@/features/editorial/components/report-screen";

export default function RunReportPage(
  props: PageProps<"/[locale]/dashboard/runs/[analysisRunId]/report">,
) {
  return (
    <main
      className="mx-auto w-full max-w-6xl px-3 py-6 sm:px-6"
      id="main-content"
      tabIndex={-1}
    >
      <ReportScreen params={props.params} searchParams={props.searchParams} />
    </main>
  );
}
