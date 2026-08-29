import { SavedRedirect } from "@/features/account/components/saved-redirect";

export default function SavedPage(props: PageProps<"/[locale]/saved">) {
  return (
    <main id="main-content" tabIndex={-1}>
      <SavedRedirect searchParams={props.searchParams} />
    </main>
  );
}
