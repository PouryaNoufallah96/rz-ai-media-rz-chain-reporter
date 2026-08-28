import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { Suspended } from "@/components/fetcher/suspended";
import { OPERATIONS_NAMESPACE } from "@/features/operations/constants";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { getSourceCatalog } from "@/features/sources/api/server/get-source-catalog";
import { Localized } from "@/i18n/client";
import { getT } from "@/i18n/server";
import {
  customerBrandPolicy,
  customerEditorial,
} from "@/lib/customer-template.server";

import { getEditorialWorkspace } from "../api/server/get-editorial-workspace";
import { getPlatformDrafts } from "../api/server/get-platform-drafts";
import { getRunOptions } from "../api/server/get-run-options";
import { EDITORIAL_NAMESPACE } from "../constants";
import type { WorkspaceSearchParams } from "../schemas/workspace";
import { EditorialCoordinator } from "./editorial-coordinator";

const LIMITED_GUIDANCE_BRANDS = customerBrandPolicy
  .filter((brand) => brand.brandBible === null)
  .map((brand) => brand.key);

export function EditorialScreen({
  searchParams,
}: {
  searchParams: WorkspaceSearchParams;
}) {
  return (
    <Suspended
      data={() => getT(EDITORIAL_NAMESPACE)}
      fallback={<EditorialHeadingSkeleton />}
    >
      {(t) => (
        <>
          <h1 className="px-3 pt-5 font-semibold text-2xl tracking-display sm:px-6">
            {t("title")}
          </h1>
          <Suspended
            data={async () => {
              const [workspace, options, catalog] = await Promise.all([
                getEditorialWorkspace(searchParams),
                getRunOptions(),
                getSourceCatalog(),
              ]);
              const platformDraftLanes = workspace.head
                ? await getPlatformDrafts(workspace.head.id)
                : [];
              return [workspace, options, catalog, platformDraftLanes] as const;
            }}
            fallback={<ConfigurationSkeleton label={t("table.loading")} />}
          >
            {([workspace, options, catalog, platformDraftLanes]) => (
              <Localized
                namespaces={[
                  SHARED_NAMESPACE,
                  EDITORIAL_NAMESPACE,
                  OPERATIONS_NAMESPACE,
                ]}
              >
                <div className="min-w-0 p-3 sm:px-6 sm:pt-4 sm:pb-6">
                  <EditorialCoordinator
                    defaultModelOptionKey={
                      customerEditorial.defaults.models[0] ??
                      customerEditorial.models[0]?.key ??
                      ""
                    }
                    key={workspace.head?.id ?? "fresh-workspace"}
                    limitedGuidanceBrands={LIMITED_GUIDANCE_BRANDS}
                    options={options}
                    platformDraftLanes={platformDraftLanes}
                    sources={catalog.entries}
                    templatePlatforms={customerEditorial.platforms}
                    workspace={workspace}
                  />
                </div>
              </Localized>
            )}
          </Suspended>
        </>
      )}
    </Suspended>
  );
}

function EditorialHeadingSkeleton() {
  return <Skeleton className="ms-3 mt-5 h-8 w-56 sm:ms-6" />;
}

function ConfigurationSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="min-w-0 p-3 sm:px-6 sm:pt-4 sm:pb-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="relative grid min-w-0 grid-cols-[0rem_minmax(0,1fr)] items-start gap-y-3 min-[900px]:grid-cols-[20rem_minmax(0,1fr)] min-[900px]:gap-x-5">
        <div className="col-span-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 min-[900px]:grid-cols-subgrid">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-20 max-sm:h-11" />
            <Skeleton className="size-8 max-sm:size-11" />
          </div>
          <Skeleton className="h-4 w-12" />
        </div>
        <Skeleton className="col-start-1 row-start-2 h-96 w-80 max-[899px]:absolute max-[899px]:inset-s-0 max-[899px]:top-0 max-[899px]:z-30 max-[899px]:max-h-[calc(100dvh-10rem)] max-[899px]:max-w-[calc(100vw-2rem)]" />
        <Skeleton className="col-start-2 row-start-2 h-120 w-full" />
      </div>
    </div>
  );
}
