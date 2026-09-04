import { PageMain } from "@/components/layout/page-container";
import { SourcesScreen } from "@/features/sources/components/sources-screen";

export default function SourcesPage(props: PageProps<"/[locale]/sources">) {
  return (
    <PageMain>
      <SourcesScreen searchParams={props.searchParams} />
    </PageMain>
  );
}
