import { UsageScreen } from "@/features/usage/components/usage-screen";

export default function UsagePage(props: PageProps<"/[locale]/usage">) {
  return (
    <main
      className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 lg:px-8"
      id="main-content"
      tabIndex={-1}
    >
      <UsageScreen searchParams={props.searchParams} />
    </main>
  );
}
