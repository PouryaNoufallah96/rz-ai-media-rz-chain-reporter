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
          <h1 className="px-3 pt-4 font-semibold text-3xl sm:px-6">
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
            fallback={<ConfigurationSkeleton />}
          >
            {([workspace, options, catalog, platformDraftLanes]) => (
              <Localized
                namespaces={[
                  SHARED_NAMESPACE,
                  EDITORIAL_NAMESPACE,
                  OPERATIONS_NAMESPACE,
                ]}
              >
                <div className="min-w-0 p-3 sm:p-6">
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
  return <Skeleton className="mt-2 h-9 w-72" />;
}

function ConfigurationSkeleton() {
  return (
    <div aria-busy="true" className="p-3 sm:p-6">
      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(280px,22rem)_1fr]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-[30rem] w-full" />
      </div>
    </div>
  );
}
