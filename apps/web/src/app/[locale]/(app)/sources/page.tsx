import { SourcesScreen } from "@/features/sources/components/sources-screen";

export const prefetch = "partial";

export default function SourcesPage(props: PageProps<"/[locale]/sources">) {
  return (
    <main id="main-content">
      <SourcesScreen searchParams={props.searchParams} />
    </main>
  );
}
