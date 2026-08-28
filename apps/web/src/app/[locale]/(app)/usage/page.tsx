import { UsageScreen } from "@/features/usage/components/usage-screen";

export default function UsagePage(props: PageProps<"/[locale]/usage">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10" id="main-content">
      <UsageScreen searchParams={props.searchParams} />
    </main>
  );
}
