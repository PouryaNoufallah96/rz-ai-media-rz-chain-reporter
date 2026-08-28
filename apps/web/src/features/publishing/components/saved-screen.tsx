import { DataTableSkeleton } from "@/components/data-table/skeleton";
import { Suspended } from "@/components/fetcher/suspended";
import { Localized } from "@/i18n/client";
import { getT } from "@/i18n/server";

import { getSavedHistory } from "../api/server/get-saved-history";
import { PUBLISHING_NAMESPACE } from "../constants";
import type { PublishingSearchParams } from "../schemas/history";
import { SavedTable } from "./saved-table";

export function SavedScreen({
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
          <h1 className="mt-2 font-semibold text-3xl">{t("saved.title")}</h1>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            {t("saved.subtitle")}
          </p>
          <Suspended
            data={() => getSavedHistory(searchParams)}
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
                <SavedTable {...view} />
              </Localized>
            )}
          </Suspended>
        </>
      )}
    </Suspended>
  );
}
