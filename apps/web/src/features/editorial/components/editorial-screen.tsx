import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { cn } from "@rz-chain-reporter/ui/lib/utils";

import { Suspended } from "@/components/fetcher/suspended";
import { OPERATIONS_NAMESPACE } from "@/features/operations/constants";
import { PUBLISHING_NAMESPACE } from "@/features/publishing/constants";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { getSourceCatalog } from "@/features/sources/api/server/get-source-catalog";
import { Localized } from "@/i18n/client";
import { getT } from "@/i18n/server";
import {
  customerBrandPolicy,
  customerEditorial,
  enabledImageModels,
} from "@/lib/customer-template.server";

import { getEditorialWorkspace } from "../api/server/get-editorial-workspace";
import { getPlatformDrafts } from "../api/server/get-platform-drafts";
import { getRunOptions } from "../api/server/get-run-options";
import { EDITORIAL_NAMESPACE } from "../constants";
import type { WorkspaceSearchParams } from "../schemas/workspace";
import { EditorialCoordinator } from "./editorial-coordinator";
import { LANE_WIDTH_CLASS_NAME } from "./lane-layout";

const LIMITED_GUIDANCE_BRANDS = customerBrandPolicy
  .filter((brand) => brand.brandBible === null)
  .map((brand) => brand.key);

const SKELETON_BRANDS = customerEditorial.defaults.brands;
const SKELETON_MODELS = customerEditorial.models;
const SKELETON_LANES = [
  ...customerEditorial.defaults.platforms,
  "fresh-card-1",
  "fresh-card-2",
];
const SKELETON_SOURCE_CHIPS = [
  "source-1",
  "source-2",
  "source-3",
  "source-4",
  "source-5",
  "source-6",
  "source-7",
  "source-8",
];

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
                  PUBLISHING_NAMESPACE,
                ]}
              >
                <div className="min-w-0 p-3 sm:px-6 sm:pt-4 sm:pb-6">
                  <EditorialCoordinator
                    defaultModelOptionKey={
                      customerEditorial.defaults.models[0] ??
                      customerEditorial.models[0]?.key ??
                      ""
                    }
                    imageModels={enabledImageModels}
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
      <div className="relative grid min-w-0 grid-cols-[0rem_minmax(0,1fr)] workspace:grid-cols-[22rem_minmax(0,1fr)] items-start workspace:gap-x-5 gap-y-3">
        <div className="col-span-2 grid grid-cols-[auto_minmax(0,1fr)] workspace:grid-cols-subgrid items-center gap-x-5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-20 max-sm:h-11" />
            <Skeleton className="size-8 max-sm:size-11" />
          </div>
          <Skeleton className="h-4 w-12" />
        </div>
        <aside
          aria-hidden="true"
          className="workspace:sticky workspace:top-4 col-start-1 row-start-2 flex workspace:max-h-[calc(100dvh-2rem)] w-88 min-w-0 flex-col gap-4 workspace:overflow-y-auto rounded-xl border border-sidebar-border bg-sidebar p-3 text-sidebar-foreground max-workspace:hidden"
        >
          <div className="grid gap-2">
            <Skeleton className="h-4 w-16" />
            <div className="grid grid-cols-2 gap-1">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          </div>
          <div className="grid gap-3">
            <Skeleton className="h-4 w-24" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {SKELETON_BRANDS.map((brandKey) => (
                <div className="flex items-center gap-2" key={brandKey}>
                  <Skeleton className="size-4 shrink-0" />
                  <Skeleton className="h-4 w-24 max-w-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3">
            <Skeleton className="h-4 w-28" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {SKELETON_MODELS.map((model) => (
                <div className="flex items-center gap-2" key={model.key}>
                  <Skeleton className="size-4 shrink-0" />
                  <Skeleton className="h-4 w-20 max-w-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3">
            <Skeleton className="h-4 w-20" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {customerEditorial.platforms.map((platform) => (
                <div className="flex items-center gap-2" key={platform}>
                  <Skeleton className="size-4 shrink-0" />
                  <Skeleton className="h-4 w-20 max-w-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-4 w-16" />
            <div className="grid h-44 content-start gap-2 rounded-xl border border-sidebar-border p-3">
              <Skeleton className="h-7 w-full" />
              <div className="flex flex-wrap gap-2">
                {SKELETON_SOURCE_CHIPS.map((chipKey) => (
                  <Skeleton className="h-6 w-20" key={chipKey} />
                ))}
              </div>
            </div>
          </div>
          <div className="grid gap-3">
            <Skeleton className="h-4 w-20" />
            <div className="flex gap-2">
              <Skeleton className="h-7 w-10" />
              <Skeleton className="h-7 w-10" />
              <Skeleton className="h-7 w-10" />
              <Skeleton className="h-7 w-10" />
            </div>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </aside>
        <div className="col-start-2 row-start-2 grid min-w-0 gap-4">
          {SKELETON_BRANDS.map((brandKey) => (
            <section
              aria-hidden="true"
              className="min-w-0 rounded-xl border border-border bg-card/40 p-3"
              key={brandKey}
            >
              <div className="flex items-center gap-2 pb-1">
                <Skeleton className="size-7" />
                <Skeleton className="h-5 w-28" />
              </div>
              <div className="flex min-w-0 gap-3 overflow-hidden py-1">
                {SKELETON_LANES.map((laneKey) => (
                  <Skeleton
                    className={cn(
                      "min-h-48 shrink-0 rounded-lg",
                      LANE_WIDTH_CLASS_NAME,
                    )}
                    key={laneKey}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
