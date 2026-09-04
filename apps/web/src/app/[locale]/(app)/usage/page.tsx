import { PageMain } from "@/components/layout/page-container";
import { UsageScreen } from "@/features/usage/components/usage-screen";

export default function UsagePage(props: PageProps<"/[locale]/usage">) {
  return (
    <PageMain>
      <UsageScreen searchParams={props.searchParams} />
    </PageMain>
  );
}
