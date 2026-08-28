import { SourcesScreen } from "@/features/sources/components/sources-screen";

export default function SourcesPage(props: PageProps<"/[locale]/sources">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10" id="main-content">
      <SourcesScreen searchParams={props.searchParams} />
    </main>
  );
}
