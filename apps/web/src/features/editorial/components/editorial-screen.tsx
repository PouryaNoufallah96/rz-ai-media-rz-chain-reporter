import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { Suspended } from "@/components/fetcher/suspended";
import { OPERATIONS_NAMESPACE } from "@/features/operations/constants";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { getSourceCatalog } from "@/features/sources/api/server/get-source-catalog";
import { Localized } from "@/i18n/client";
import { getFormatter, getT } from "@/i18n/server";
import {
  customerBrandPolicy,
  customerEditorial,
  customerTemplateFingerprint,
} from "@/lib/customer-template.server";

import { getEditorialWorkspace } from "../api/server/get-editorial-workspace";
import { getPlatformDrafts } from "../api/server/get-platform-drafts";
import { getRunOptions } from "../api/server/get-run-options";
import { EDITORIAL_NAMESPACE } from "../constants";
import type { WorkspaceSearchParams } from "../schemas/workspace";
import { LaneBoard } from "./lane-board";
import { RunConfigurationForm } from "./run-configuration-form";
import { RunHead } from "./run-head";

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
      data={() => Promise.all([getT(EDITORIAL_NAMESPACE), getFormatter()])}
      fallback={<EditorialHeadingSkeleton />}
    >
      {([t, format]) => (
        <>
          <h1 className="mt-2 font-semibold text-3xl">{t("title")}</h1>
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
              <>
                {workspace.head && workspace.query.run === null ? (
                  <p className="mt-3 text-muted-foreground">
                    {t("caption.latestRun", {
                      time: format.dateTime(workspace.head.startedAt, {
                        dateStyle: "short",
                        timeStyle: "short",
                      }),
                    })}
                  </p>
                ) : null}
                <Localized
                  namespaces={[
                    SHARED_NAMESPACE,
                    EDITORIAL_NAMESPACE,
                    OPERATIONS_NAMESPACE,
                  ]}
                >
                  <div className="mt-6 grid gap-6 min-[900px]:grid-cols-[minmax(280px,22rem)_1fr]">
                    <div className="min-[900px]:sticky min-[900px]:top-4 min-[900px]:max-h-[calc(100dvh-2rem)] min-[900px]:self-start min-[900px]:overflow-y-auto">
                      <RunConfigurationForm
                        options={options}
                        sources={catalog.entries}
                      />
                    </div>
                    <div className="min-w-0">
                      <RunHead
                        head={workspace.head}
                        readAt={workspace.readAt}
                        runs={options.runs}
                        selectedRunId={workspace.query.run}
                        templateFingerprint={customerTemplateFingerprint}
                      />
                      {workspace.head ? (
                        <LaneBoard
                          brands={options.brands}
                          defaultModelOptionKey={
                            customerEditorial.defaults.models[0] ??
                            customerEditorial.models[0]?.key ??
                            ""
                          }
                          head={workspace.head}
                          limitedGuidanceBrands={LIMITED_GUIDANCE_BRANDS}
                          models={options.models}
                          modelLanes={workspace.modelLanes}
                          platformDraftLanes={platformDraftLanes}
                          templatePlatforms={customerEditorial.platforms}
                          telegramLanes={workspace.telegramLanes}
                        />
                      ) : null}
                    </div>
                  </div>
                </Localized>
              </>
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
    <div aria-busy="true">
      <Skeleton className="mt-3 h-6 w-full max-w-md" />
      <div className="mt-6 grid gap-6 min-[900px]:grid-cols-[minmax(280px,22rem)_1fr]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
