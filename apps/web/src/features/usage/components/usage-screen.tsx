import {
  Card,
  CardContent,
  CardHeader,
} from "@rz-chain-reporter/ui/components/card";
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
          <h1 className="font-semibold text-2xl tracking-display">
            {t("title")}
          </h1>
          <p className="mt-2 max-w-3xl text-muted-foreground text-sm/relaxed">
            {t("subtitle")}
          </p>
          <Suspended
            data={() => getUsageView(searchParams)}
            fallback={<UsageReportSkeleton loadingLabel={t("table.loading")} />}
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
    <div aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-5 w-full max-w-3xl" />
    </div>
  );
}

function UsageReportSkeleton({ loadingLabel }: { loadingLabel: string }) {
  const filters = Array.from({ length: 6 }, (_, index) => index);
  const facts = Array.from({ length: 5 }, (_, index) => index);
  const modelRows = Array.from({ length: 3 }, (_, index) => index);

  return (
    <div aria-busy="true">
      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 sm:p-4">
        {filters.map((filter) => (
          <div
            className="flex min-w-0 flex-1 flex-col gap-2 sm:w-fit sm:flex-none"
            key={filter}
          >
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-full sm:w-32" />
          </div>
        ))}
        <div className="ms-auto flex flex-wrap items-end gap-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-16" />
        </div>
      </div>
      <section className="mt-6">
        <Card className="gap-0 border ring-0">
          <CardHeader className="border-b bg-muted/30 py-4">
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="px-0">
            <dl className="grid grid-cols-2 gap-4 border-b p-4 sm:grid-cols-3 sm:p-5 lg:grid-cols-5">
              {facts.map((fact) => (
                <div key={fact}>
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="mt-2 h-6 w-16" />
                </div>
              ))}
            </dl>
            <div className="grid gap-4 p-4">
              {modelRows.map((row) => (
                <Skeleton className="h-4 w-full" key={row} />
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
      <section className="mt-6">
        <Skeleton className="mb-3 h-5 w-32" />
        <DataTableSkeleton columnCount={9} labels={{ loading: loadingLabel }} />
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Skeleton className="h-7 w-20 max-sm:h-11" />
          <Skeleton className="h-7 w-20 max-sm:h-11" />
        </div>
      </section>
    </div>
  );
}
