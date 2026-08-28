import { PublishingScreen } from "@/features/publishing/components/publishing-screen";

export default function SchedulePage(props: PageProps<"/[locale]/schedule">) {
  return (
    <main
      className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 lg:px-8"
      id="main-content"
      tabIndex={-1}
    >
      <PublishingScreen searchParams={props.searchParams} />
    </main>
  );
}
