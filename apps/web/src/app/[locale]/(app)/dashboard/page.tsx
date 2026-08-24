import { EditorialScreen } from "@/features/editorial/components/editorial-screen";

export default function DashboardPage(props: PageProps<"/[locale]/dashboard">) {
  return (
    <main id="main-content">
      <EditorialScreen searchParams={props.searchParams} />
    </main>
  );
}
