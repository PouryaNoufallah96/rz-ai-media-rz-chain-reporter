import { PageMain } from "@/components/layout/page-container";
import { PublishingScreen } from "@/features/publishing/components/publishing-screen";

export default function SchedulePage(props: PageProps<"/[locale]/schedule">) {
  return (
    <PageMain>
      <PublishingScreen searchParams={props.searchParams} />
    </PageMain>
  );
}
