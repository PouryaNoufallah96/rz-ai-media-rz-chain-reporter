"use client";

import type { Platform } from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarTrigger,
} from "@rz-chain-reporter/ui/components/sidebar";
import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

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
import {
  type BoardPresentation,
  LaneBoard,
  LaneBoardHeader,
} from "./lane-board";
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
  const boardHeadingId = useId();
  const [presentation, setPresentation] = useState<BoardPresentation>(() =>
    initialPresentation(workspace.head, options, templatePlatforms),
  );
  const [finalFocus, setFinalFocus] = useState<HTMLElement | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarPanel = useRef<HTMLDivElement>(null);
  const sidebarTrigger = useRef<HTMLButtonElement>(null);
  const { setValues, values } = useTransitionUrlState(workspaceSearchParsers);
  const selectedDraft = platformDraftLanes
    .flatMap((lane) => lane.drafts)
    .find((card) => card.id === values.draft);

  return (
    <>
      <Sidebar
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            !event.defaultPrevented &&
            sidebarOpen
          ) {
            event.preventDefault();
            sidebarTrigger.current?.focus();
            setSidebarOpen(false);
          }
        }}
        onOpenChange={(open) => {
          if (!open && sidebarPanel.current?.contains(document.activeElement)) {
            sidebarTrigger.current?.focus();
          }
          setSidebarOpen(open);
        }}
        open={sidebarOpen}
      >
        <SidebarHeader className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 min-[900px]:group-data-open/sidebar:grid-cols-subgrid">
          <div className="flex items-center gap-2">
            <SidebarTrigger ref={sidebarTrigger}>
              {t("run.title")}
            </SidebarTrigger>
            <Button
              aria-label={t("run.newWorkspace")}
              className="max-sm:size-11"
              nativeButton={false}
              render={<Link href="/dashboard" />}
              size="icon"
              variant="outline"
            >
              <PlusIcon aria-hidden="true" />
            </Button>
          </div>
          <LaneBoardHeader head={workspace.head} id={boardHeadingId} />
        </SidebarHeader>
        <SidebarContent
          aria-label={t("run.title")}
          inert={!sidebarOpen}
          ref={sidebarPanel}
        >
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
        </SidebarContent>
        <section
          aria-labelledby={boardHeadingId}
          className="col-start-2 row-start-2 min-w-0"
        >
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
        </section>
      </Sidebar>
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
