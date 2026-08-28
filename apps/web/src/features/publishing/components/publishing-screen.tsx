import { DataTableSkeleton } from "@/components/data-table/skeleton";
import { Suspended } from "@/components/fetcher/suspended";
import { Localized } from "@/i18n/client";
import { getT } from "@/i18n/server";

import { getPublishingHistory } from "../api/server/get-publishing-history";
import { PUBLISHING_NAMESPACE } from "../constants";
import type { PublishingSearchParams } from "../schemas/history";
import { PublishingDesk } from "./publishing-desk";

export function PublishingScreen({
  searchParams,
}: {
  searchParams: PublishingSearchParams;
}) {
  return (
    <Suspended
      data={() => getT(PUBLISHING_NAMESPACE)}
      fallback={<div className="h-20" />}
    >
      {(t) => (
        <>
          <h1 className="font-semibold text-2xl tracking-display">
            {t("desk.title")}
          </h1>
          <p className="mt-2 max-w-3xl text-muted-foreground text-sm/relaxed">
            {t("desk.subtitle")}
          </p>
          <Suspended
            data={() => getPublishingHistory(searchParams)}
            fallback={
              <div className="mt-6">
                <DataTableSkeleton
                  columnCount={6}
                  labels={{ loading: t("table.loading") }}
                />
              </div>
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
