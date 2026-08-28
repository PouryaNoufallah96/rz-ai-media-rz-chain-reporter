import { SourcesScreen } from "@/features/sources/components/sources-screen";

export default function SourcesPage(props: PageProps<"/[locale]/sources">) {
  return (
    <main
      className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 lg:px-8"
      id="main-content"
      tabIndex={-1}
    >
      <SourcesScreen searchParams={props.searchParams} />
    </main>
  );
}
