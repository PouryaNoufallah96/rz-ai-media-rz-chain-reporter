import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { Suspended } from "@/components/fetcher/suspended";
import { getT } from "@/i18n/server";
import { customerProductName } from "@/lib/customer-template.server";

import { LANDING_NAMESPACE } from "../constants";

export function LandingScreen() {
  return (
    <Suspended
      data={() => getT(LANDING_NAMESPACE)}
      fallback={<LandingHeadingSkeleton />}
    >
      {(t) => (
        <>
          <p className="mb-3 font-medium text-muted-foreground text-sm">
            {t("eyebrow")}
          </p>
          <h1 className="max-w-3xl text-balance font-semibold text-4xl sm:text-6xl">
            {customerProductName}
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-lg text-muted-foreground">
            {t("body")}
          </p>
        </>
      )}
    </Suspended>
  );
}

function LandingHeadingSkeleton() {
  return (
    <>
      <Skeleton className="mb-3 h-4 w-32" />
      <Skeleton className="h-14 w-full max-w-3xl" />
      <Skeleton className="mt-5 h-6 w-full max-w-2xl" />
    </>
  );
}
