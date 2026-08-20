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
          <h1 className="mt-2 font-semibold text-3xl">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">{t("intro")}</p>
          <Suspended
            data={getInstallationOverview}
            fallback={
              <InstallationSectionsSkeleton
                loadingLabel={t("loading")}
                sectionTitles={INSTALLATION_SECTIONS.map((section) =>
                  t(`${section}.title`),
                )}
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
      <Skeleton className="mt-2 h-9 w-64" />
      <Skeleton className="mt-3 h-6 w-full max-w-2xl" />
    </>
  );
}
