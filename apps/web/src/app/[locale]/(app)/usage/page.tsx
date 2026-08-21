import { UsageScreen } from "@/features/usage/components/usage-screen";

export default function UsagePage(props: PageProps<"/[locale]/usage">) {
  return (
    <main id="main-content">
      <UsageScreen searchParams={props.searchParams} />
    </main>
  );
}
