import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { Suspended } from "@/components/fetcher/suspended";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { getT } from "@/i18n/server";
import { customerProductName } from "@/lib/customer-template.server";

export default function Home() {
  return (
    <main
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16"
      id="main-content"
    >
      <Suspended
        data={() => getT(SHARED_NAMESPACE)}
        fallback={<HomeSkeleton />}
      >
        {(t) => (
          <>
            <p className="mb-3 font-medium text-muted-foreground text-sm">
              {t("landing.eyebrow")}
            </p>
            <h1 className="max-w-3xl text-balance font-semibold text-4xl sm:text-6xl">
              {customerProductName}
            </h1>
            <p className="mt-5 max-w-2xl text-pretty text-lg text-muted-foreground">
              {t("landing.body")}
            </p>
          </>
        )}
      </Suspended>
    </main>
  );
}

function HomeSkeleton() {
  return (
    <>
      <Skeleton className="mb-3 h-4 w-32 motion-reduce:animate-none" />
      <Skeleton className="h-14 w-full max-w-3xl motion-reduce:animate-none" />
      <Skeleton className="mt-5 h-6 w-full max-w-2xl motion-reduce:animate-none" />
    </>
  );
}
