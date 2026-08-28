import { PublishingScreen } from "@/features/publishing/components/publishing-screen";

export default function SchedulePage(props: PageProps<"/[locale]/schedule">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10" id="main-content">
      <PublishingScreen searchParams={props.searchParams} />
    </main>
  );
}
