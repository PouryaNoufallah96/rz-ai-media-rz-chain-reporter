import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { Suspended } from "@/components/fetcher/suspended";
import { getT } from "@/i18n/server";

import { DASHBOARD_NAMESPACE } from "../constants";

export function DashboardScreen() {
  return (
    <Suspended
      data={() => getT(DASHBOARD_NAMESPACE)}
      fallback={<DashboardHeadingSkeleton />}
    >
      {(t) => (
        <>
          <h1 className="mt-2 font-semibold text-3xl">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">{t("body")}</p>
        </>
      )}
    </Suspended>
  );
}

function DashboardHeadingSkeleton() {
  return (
    <>
      <Skeleton className="mt-2 h-9 w-72" />
      <Skeleton className="mt-3 h-6 w-full max-w-2xl" />
    </>
  );
}
