import { AccountScreen } from "@/features/account/components/account-screen";

export default function AccountPage(props: PageProps<"/[locale]/account">) {
  return (
    <main id="main-content" tabIndex={-1}>
      <AccountScreen searchParams={props.searchParams} />
    </main>
  );
}
