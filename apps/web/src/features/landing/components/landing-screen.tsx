import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { MetalButton } from "@rz-chain-reporter/ui/components/metal-button";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { ArrowUpRightIcon } from "lucide-react";

import { Suspended } from "@/components/fetcher/suspended";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Link } from "@/i18n/navigation";
import { getT } from "@/i18n/server";
import { customerProductName } from "@/lib/customer-template.server";
import { LANDING_NAMESPACE } from "../constants";
import { LandingLightPillar } from "./landing-light-pillar";

export function LandingScreen() {
  return (
    <Suspended
      data={() => getT(LANDING_NAMESPACE)}
      fallback={<LandingHeadingSkeleton />}
    >
      {(t) => (
        <section className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <LandingLightPillar />
          <div className="relative z-10 mx-auto w-full max-w-2xl px-5 py-16 text-center sm:px-8 sm:py-24">
            <h1 className="text-balance font-medium text-4xl leading-[1.12] tracking-display sm:text-5xl lg:text-6xl">
              {t("title")}
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-foreground/80 text-lg leading-8">
              {t.rich("body", {
                product: () => <Bdi>{customerProductName}</Bdi>,
              })}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <MetalButton
                className="min-h-11 px-5"
                nativeButton={false}
                render={<Link href="/dashboard" />}
                size="lg"
              >
                {t("openWorkspace")}
                <ArrowUpRightIcon data-icon="inline-end" />
              </MetalButton>
              <Button
                className="min-h-11 px-4"
                nativeButton={false}
                render={<Link href="/login" />}
                size="lg"
                variant="outline"
              >
                {t("signIn")}
              </Button>
            </div>
            <p className="mt-5 text-foreground/65 text-sm">{t("access")}</p>
          </div>
        </section>
      )}
    </Suspended>
  );
}

async function LandingHeadingSkeleton() {
  const t = await getT(SHARED_NAMESPACE);
  return (
    <div
      aria-busy
      className="relative isolate flex min-h-0 flex-1 items-center justify-center px-5 py-16"
    >
      <span className="sr-only" role="status">
        {t("loader.loading")}
      </span>
      <div className="grid w-full max-w-2xl justify-items-center gap-5">
        <Skeleton className="h-24 w-full max-w-xl" />
        <Skeleton className="h-16 w-full max-w-lg" />
        <Skeleton className="h-11 w-40" />
      </div>
    </div>
  );
}
