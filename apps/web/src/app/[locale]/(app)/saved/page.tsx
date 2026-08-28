import { SavedRedirect } from "@/features/account/components/saved-redirect";

export default function SavedPage(props: PageProps<"/[locale]/saved">) {
  return (
    <main id="main-content">
      <SavedRedirect searchParams={props.searchParams} />
    </main>
  );
}
