import { EditorialScreen } from "@/features/editorial/components/editorial-screen";

export default function DashboardPage(props: PageProps<"/[locale]/dashboard">) {
  return (
    <main id="main-content" tabIndex={-1}>
      <EditorialScreen searchParams={props.searchParams} />
    </main>
  );
}
