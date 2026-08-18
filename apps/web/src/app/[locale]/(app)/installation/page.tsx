import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { Suspended } from "@/components/fetcher/suspended";
import { getInstallationOverview } from "@/features/installation/api/server/get-installation";
import {
  InstallationSections,
  InstallationSectionsSkeleton,
} from "@/features/installation/components/installation-sections";
import {
  INSTALLATION_NAMESPACE,
  INSTALLATION_SECTIONS,
} from "@/features/installation/constants";
import { getT } from "@/i18n/server";

export default function InstallationPage() {
  return (
    <main id="main-content">
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
    </main>
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
