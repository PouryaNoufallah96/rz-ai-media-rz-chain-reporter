import { Suspended } from "@/components/fetcher/suspended";
import {
  loadSavedSearchParams,
  normalizeSavedQuery,
  type PublishingSearchParams,
} from "@/features/publishing/schemas/history";
import { redirect } from "@/i18n/navigation";
import { currentLocale } from "@/i18n/server";

export function SavedRedirect({
  searchParams,
}: {
  searchParams: PublishingSearchParams;
}) {
  return (
    <Suspended data={() => redirectToAccount(searchParams)} fallback={null}>
      {() => null}
    </Suspended>
  );
}

async function redirectToAccount(searchParams: PublishingSearchParams) {
  const query = normalizeSavedQuery(await loadSavedSearchParams(searchParams));
  return redirect({
    href: {
      pathname: "/account",
      query: {
        savedState: query.state,
        ...(query.cursor ? { savedCursor: query.cursor } : {}),
      },
    },
    locale: await currentLocale(),
  });
}
