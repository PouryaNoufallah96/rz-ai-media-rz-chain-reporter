import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { DataTableSkeleton } from "@/components/data-table/skeleton";
import { Suspended } from "@/components/fetcher/suspended";
import { Localized } from "@/i18n/client";
import { getT } from "@/i18n/server";

import { getPublishingHistory } from "../api/server/get-publishing-history";
import { PUBLISHING_NAMESPACE, PUBLISHING_VIEWS } from "../constants";
import {
  loadPublishingSearchParams,
  normalizePublishingQuery,
  type PublishingSearchParams,
} from "../schemas/history";
import { PublishingDesk } from "./publishing-desk";

export function PublishingScreen({
  searchParams,
}: {
  searchParams: PublishingSearchParams;
}) {
  return (
    <Suspended
      data={() => getT(PUBLISHING_NAMESPACE)}
      fallback={<PublishingHeadingSkeleton />}
    >
      {(t) => (
        <>
          <h1 className="text-balance font-semibold text-2xl tracking-display">
            {t("desk.title")}
          </h1>
          <p className="mt-2 max-w-3xl text-pretty text-muted-foreground text-sm/relaxed">
            {t("desk.subtitle")}
          </p>
          <Suspended
            data={async () =>
              getPublishingHistory(
                normalizePublishingQuery(
                  await loadPublishingSearchParams(searchParams),
                ),
              )
            }
            fallback={
              <PublishingDeskSkeleton loadingLabel={t("table.loading")} />
            }
          >
            {(view) => (
              <Localized namespaces={[PUBLISHING_NAMESPACE]}>
                <PublishingDesk {...view} />
              </Localized>
            )}
          </Suspended>
        </>
      )}
    </Suspended>
  );
}

function PublishingHeadingSkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-5 w-full max-w-3xl" />
    </div>
  );
}

function PublishingDeskSkeleton({ loadingLabel }: { loadingLabel: string }) {
  return (
    <section aria-busy="true" className="mt-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 sm:p-4">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="ms-auto h-7 w-24" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 w-16 max-sm:h-11" />
        </div>
      </div>
      <div className="my-4 flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-muted/30 p-1">
        {PUBLISHING_VIEWS.map((view) => (
          <Skeleton className="h-7 w-24" key={view} />
        ))}
      </div>
      <DataTableSkeleton columnCount={6} labels={{ loading: loadingLabel }} />
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Skeleton className="h-7 w-20 max-sm:h-11" />
        <Skeleton className="h-7 w-20 max-sm:h-11" />
      </div>
    </section>
  );
}
