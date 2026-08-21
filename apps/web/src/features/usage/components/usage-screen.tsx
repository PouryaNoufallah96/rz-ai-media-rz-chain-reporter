import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { DataTableSkeleton } from "@/components/data-table/skeleton";
import { Suspended } from "@/components/fetcher/suspended";
import { Localized } from "@/i18n/client";
import { getT } from "@/i18n/server";

import { getUsageView } from "../api/server/get-usage";
import { USAGE_NAMESPACE } from "../constants";
import type { UsageSearchParams } from "../schemas/usage";
import { UsageReport } from "./usage-report";

export function UsageScreen({
  searchParams,
}: {
  searchParams: UsageSearchParams;
}) {
  return (
    <Suspended
      data={() => getT(USAGE_NAMESPACE)}
      fallback={<UsageHeadingSkeleton />}
    >
      {(t) => (
        <>
          <h1 className="mt-2 font-semibold text-3xl">{t("title")}</h1>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            {t("subtitle")}
          </p>
          <Suspended
            data={() => getUsageView(searchParams)}
            fallback={
              <div className="mt-6">
                <DataTableSkeleton
                  columnCount={8}
                  labels={{ loading: t("table.loading") }}
                />
              </div>
            }
          >
            {(view) => (
              <Localized namespaces={[USAGE_NAMESPACE]}>
                <UsageReport {...view} />
              </Localized>
            )}
          </Suspended>
        </>
      )}
    </Suspended>
  );
}

function UsageHeadingSkeleton() {
  return (
    <>
      <Skeleton className="mt-2 h-9 w-48" />
      <Skeleton className="mt-3 h-6 w-full max-w-3xl" />
    </>
  );
}
