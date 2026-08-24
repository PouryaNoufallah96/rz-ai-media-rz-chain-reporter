import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { Suspended } from "@/components/fetcher/suspended";
import { OPERATIONS_NAMESPACE } from "@/features/operations/constants";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { getSourceCatalog } from "@/features/sources/api/server/get-source-catalog";
import { Localized } from "@/i18n/client";
import { getFormatter, getT } from "@/i18n/server";
import {
  customerBrandPolicy,
  customerTemplateFingerprint,
} from "@/lib/customer-template.server";

import { getEditorialWorkspace } from "../api/server/get-editorial-workspace";
import { getRunOptions } from "../api/server/get-run-options";
import { EDITORIAL_NAMESPACE } from "../constants";
import type { WorkspaceSearchParams } from "../schemas/workspace";
import { EditorialFreshness } from "./editorial-freshness";
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
            data={() =>
              Promise.all([
                getEditorialWorkspace(searchParams),
                getRunOptions(),
                getSourceCatalog(),
              ])
            }
            fallback={<ConfigurationSkeleton />}
          >
            {([workspace, options, catalog]) => (
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
                  <div className="mt-6 grid gap-6 min-[900px]:grid-cols-[1fr_minmax(280px,0.5fr)]">
                    <RunConfigurationForm
                      options={options}
                      sources={catalog.entries}
                    />
                    <div className="order-first min-[900px]:order-none">
                      <RunHead
                        head={workspace.head}
                        readAt={workspace.readAt}
                        runs={options.runs}
                        selectedRunId={workspace.query.run}
                        templateFingerprint={customerTemplateFingerprint}
                      />
                    </div>
                  </div>
                  {workspace.head ? (
                    <>
                      <EditorialFreshness
                        analysisRunId={workspace.head.id}
                        lifecycle={workspace.head.lifecycle}
                        readAt={workspace.readAt}
                      />
                      <LaneBoard
                        brands={options.brands}
                        head={workspace.head}
                        limitedGuidanceBrands={LIMITED_GUIDANCE_BRANDS}
                        models={options.models}
                        modelLanes={workspace.modelLanes}
                        telegramLanes={workspace.telegramLanes}
                      />
                    </>
                  ) : null}
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
      <div className="mt-6 grid gap-6 min-[900px]:grid-cols-[1fr_minmax(280px,0.5fr)]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
