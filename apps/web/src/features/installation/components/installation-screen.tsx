import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { Suspended } from "@/components/fetcher/suspended";
import { getT } from "@/i18n/server";

import { getInstallationOverview } from "../api/server/get-installation";
import { INSTALLATION_NAMESPACE, INSTALLATION_SECTIONS } from "../constants";
import {
  InstallationSections,
  InstallationSectionsSkeleton,
} from "./installation-sections";

export function InstallationScreen() {
  return (
    <Suspended
      data={() => getT(INSTALLATION_NAMESPACE)}
      fallback={<InstallationHeadingSkeleton />}
    >
      {(t) => (
        <>
          <h1 className="font-semibold text-2xl tracking-display">
            {t("title")}
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm/relaxed">
            {t("intro")}
          </p>
          <Suspended
            data={getInstallationOverview}
            fallback={
              <InstallationSectionsSkeleton
                loadingLabel={t("loading")}
                sections={INSTALLATION_SECTIONS.map((key) => ({
                  key,
                  title: t(`${key}.title`),
                }))}
              />
            }
          >
            {(installation) => (
              <InstallationSections installation={installation} />
            )}
          </Suspended>
        </>
      )}
    </Suspended>
  );
}

function InstallationHeadingSkeleton() {
  return (
    <>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-5 w-full max-w-2xl" />
    </>
  );
}
