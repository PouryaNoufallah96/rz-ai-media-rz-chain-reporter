import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { Suspended } from "@/components/fetcher/suspended";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { getT } from "@/i18n/server";

export default function DashboardPage() {
  return (
    <main id="main-content">
      <Suspended
        data={() => getT(SHARED_NAMESPACE)}
        fallback={<DashboardSkeleton />}
      >
        {(t) => (
          <>
            <h1 className="mt-2 font-semibold text-3xl">
              {t("dashboard.title")}
            </h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              {t("dashboard.body")}
            </p>
          </>
        )}
      </Suspended>
    </main>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <Skeleton className="mt-2 h-9 w-72 motion-reduce:animate-none" />
      <Skeleton className="mt-3 h-6 w-full max-w-2xl motion-reduce:animate-none" />
    </>
  );
}
