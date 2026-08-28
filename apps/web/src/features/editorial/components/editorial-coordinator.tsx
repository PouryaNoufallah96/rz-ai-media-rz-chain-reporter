"use client";

import type { Platform } from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { SourceCatalogEntry } from "@/features/sources/schemas/catalog";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";
import { Link } from "@/i18n/navigation";
import { EDITORIAL_NAMESPACE } from "../constants";
import type { PlatformDraftLane } from "../schemas/drafts";
import type {
  EditorialWorkspace,
  RunHead,
  RunOptions,
} from "../schemas/workspace";
import { workspaceSearchParsers } from "../schemas/workspace";
import { CardSheet } from "./card-sheet";
import { type BoardPresentation, LaneBoard } from "./lane-board";
import { RunConfigurationForm } from "./run-configuration-form";
import { RunHead as RunHeadPanel } from "./run-head";

export function EditorialCoordinator({
  defaultModelOptionKey,
  limitedGuidanceBrands,
  options,
  platformDraftLanes,
  sources,
  templatePlatforms,
  workspace,
}: {
  defaultModelOptionKey: string;
  limitedGuidanceBrands: readonly string[];
  options: RunOptions;
  platformDraftLanes: readonly PlatformDraftLane[];
  sources: readonly SourceCatalogEntry[];
  templatePlatforms: readonly Platform[];
  workspace: EditorialWorkspace;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [presentation, setPresentation] = useState<BoardPresentation>(() =>
    initialPresentation(workspace.head, options, templatePlatforms),
  );
  const [finalFocus, setFinalFocus] = useState<HTMLElement | null>(null);
  const { setValues, values } = useTransitionUrlState(workspaceSearchParsers);
  const selectedDraft = platformDraftLanes
    .flatMap((lane) => lane.drafts)
    .find((card) => card.id === values.draft);

  return (
    <>
      <div className="grid min-w-0 gap-4 min-[900px]:grid-cols-[minmax(280px,22rem)_minmax(0,1fr)]">
        <aside className="grid content-start gap-3 min-[900px]:sticky min-[900px]:top-4 min-[900px]:max-h-[calc(100dvh-2rem)] min-[900px]:overflow-y-auto">
          <Button
            className="w-full max-sm:min-h-11"
            nativeButton={false}
            render={<Link href="/dashboard" />}
            variant="outline"
          >
            {t("run.newWorkspace")}
          </Button>
          <RunConfigurationForm
            initialConfiguration={workspace.head?.configuration ?? null}
            onPresentationChange={setPresentation}
            options={options}
            sources={sources}
          />
          <RunHeadPanel
            head={workspace.head}
            readAt={workspace.readAt}
            runs={options.runs}
            selectedRunId={workspace.query.run}
          />
        </aside>
        <div className="min-w-0">
          <LaneBoard
            brands={options.brands}
            defaultModelOptionKey={defaultModelOptionKey}
            head={workspace.head}
            limitedGuidanceBrands={limitedGuidanceBrands}
            models={options.models}
            modelLanes={workspace.modelLanes}
            onOpenCard={(card, trigger) => {
              setFinalFocus(trigger);
              void setValues({ draft: card.id });
            }}
            platformDraftLanes={platformDraftLanes}
            presentation={presentation}
            templatePlatforms={templatePlatforms}
            telegramLanes={workspace.telegramLanes}
          />
        </div>
      </div>
      <CardSheet
        card={selectedDraft ?? null}
        finalFocus={finalFocus}
        freshness={
          workspace.head
            ? {
                analysisRunId: workspace.head.id,
                lifecycle: workspace.head.lifecycle,
                readAt: workspace.readAt,
              }
            : undefined
        }
        key={values.draft ?? "missing-draft"}
        onOpenChange={(open) => {
          if (!open) void setValues({ draft: null });
        }}
        open={values.draft !== null}
      />
    </>
  );
}

function initialPresentation(
  head: RunHead | null,
  options: RunOptions,
  templatePlatforms: readonly Platform[],
): BoardPresentation {
  if (head?.configuration.kind === "promo") {
    return {
      brandKeys: head.configuration.promo.brands,
      kind: "promo",
      platforms: templatePlatforms,
      telegramOnly: false,
    };
  }
  if (head?.configuration.kind === "news") {
    return {
      brandKeys: head.configuration.brands,
      kind: "news",
      platforms: head.configuration.platforms,
      telegramOnly: head.configuration.telegramOnly,
    };
  }

  return {
    brandKeys: options.defaults.brands,
    kind: "news",
    platforms: options.defaults.platforms,
    telegramOnly: false,
  };
}
