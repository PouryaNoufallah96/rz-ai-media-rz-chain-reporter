"use client";

import {
  isOperationInProgress,
  type ModelOption,
  type Platform,
} from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { useDirection } from "@rz-chain-reporter/ui/components/direction-provider";
import { Hint } from "@rz-chain-reporter/ui/components/hint";
import {
  Sheet,
  SheetClose,
  SheetOverlay,
  SheetPopup,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
  SheetViewport,
} from "@rz-chain-reporter/ui/components/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarTrigger,
} from "@rz-chain-reporter/ui/components/sidebar";
import { PanelLeftIcon, PlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useAssistant } from "@/features/assistant/lib/assistant-context";
import type { SourceCatalogEntry } from "@/features/sources/schemas/catalog";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";
import { Link } from "@/i18n/navigation";
import { EDITORIAL_NAMESPACE } from "../constants";
import {
  type BoardPresentation,
  configuredBoardPresentation,
} from "../lib/board-presentation";
import type { PlatformDraftLane } from "../schemas/drafts";
import type {
  EditorialWorkspace,
  RunHead,
  RunOptions,
} from "../schemas/workspace";
import { workspaceSearchParsers } from "../schemas/workspace";
import { CardSheet } from "./card-sheet";
import { LaneBoard, LaneBoardHeader } from "./lane-board";
import { RunConfigurationForm } from "./run-configuration-form";
import { RunHead as RunHeadPanel } from "./run-head";

const DESKTOP_SIDEBAR_QUERY = "(width >= 56.25rem)";

function subscribeToDesktopSidebar(change: () => void) {
  const query = window.matchMedia(DESKTOP_SIDEBAR_QUERY);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

function desktopSidebarSnapshot() {
  return window.matchMedia(DESKTOP_SIDEBAR_QUERY).matches;
}

function desktopSidebarServerSnapshot() {
  return true;
}

export function EditorialCoordinator({
  defaultModelOptionKey,
  imageModels,
  limitedGuidanceBrands,
  options,
  platformDraftLanes,
  sources,
  templatePlatforms,
  workspace,
}: {
  defaultModelOptionKey: string;
  imageModels: readonly ModelOption[];
  limitedGuidanceBrands: readonly string[];
  options: RunOptions;
  platformDraftLanes: readonly PlatformDraftLane[];
  sources: readonly SourceCatalogEntry[];
  templatePlatforms: readonly Platform[];
  workspace: EditorialWorkspace;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const direction = useDirection();
  const boardHeadingId = useId();
  const [presentation, setPresentation] = useState<BoardPresentation>(() =>
    initialPresentation(workspace.head, options, templatePlatforms),
  );
  const [finalFocus, setFinalFocus] = useState<HTMLElement | null>(null);
  const { pinCard, setBrandKeys } = useAssistant();

  useEffect(() => {
    setBrandKeys(presentation.brandKeys);

    return () => setBrandKeys([]);
  }, [presentation.brandKeys, setBrandKeys]);
  const desktopSidebar = useSyncExternalStore(
    subscribeToDesktopSidebar,
    desktopSidebarSnapshot,
    desktopSidebarServerSnapshot,
  );
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const sidebarOpen = sidebarOverride ?? desktopSidebar;
  const mobileSidebarOpen = sidebarOpen && !desktopSidebar;
  const sidebarPanel = useRef<HTMLDivElement>(null);
  const sidebarTrigger = useRef<HTMLButtonElement>(null);
  const sidebarClose = useRef<HTMLButtonElement>(null);
  const { isPending, setValues, values } = useTransitionUrlState(
    workspaceSearchParsers,
  );
  const selectedDraft = platformDraftLanes
    .flatMap((lane) => lane.drafts)
    .find((card) => card.id === values.draft);
  const configurationContents = (
    <>
      <RunConfigurationForm
        initialConfiguration={workspace.head?.configuration ?? null}
        onPresentationChange={setPresentation}
        options={options}
        runInProgress={isOperationInProgress(workspace.head?.lifecycle)}
        sources={sources}
      />
      <RunHeadPanel
        head={workspace.head}
        isPending={isPending}
        onSelectRun={(run) => void setValues({ draft: null, run })}
        readAt={workspace.readAt}
        runs={options.runs}
        selectedRunId={workspace.query.run}
        showFreshness={values.draft === null}
      />
    </>
  );

  return (
    <>
      <Sheet
        disablePointerDismissal
        onOpenChange={setSidebarOverride}
        open={mobileSidebarOpen}
      >
        <Sidebar
          className="workspace:data-open:grid-cols-[22rem_minmax(0,1fr)]"
          onKeyDown={(event) => {
            if (
              desktopSidebar &&
              event.key === "Escape" &&
              !event.defaultPrevented &&
              sidebarOpen
            ) {
              event.preventDefault();
              sidebarTrigger.current?.focus();
              setSidebarOverride(false);
            }
          }}
          onOpenChange={(open) => {
            if (
              desktopSidebar &&
              !open &&
              sidebarPanel.current?.contains(document.activeElement)
            ) {
              sidebarTrigger.current?.focus();
            }
            setSidebarOverride(open);
          }}
          open={sidebarOpen}
        >
          <SidebarHeader className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 workspace:group-data-open/sidebar:grid-cols-subgrid">
            <div className="flex items-center gap-2">
              {desktopSidebar ? (
                <SidebarTrigger ref={sidebarTrigger}>
                  {t("run.title")}
                </SidebarTrigger>
              ) : (
                <SheetTrigger
                  className="group/sidebar-trigger min-h-9 gap-2 max-sm:min-h-11"
                  ref={sidebarTrigger}
                  render={<Button variant="outline" />}
                >
                  {t("run.title")}
                  <PanelLeftIcon
                    aria-hidden="true"
                    className="rtl:rotate-180"
                    data-icon="inline-end"
                  />
                </SheetTrigger>
              )}
              <Hint label={t("run.newWorkspace")}>
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
              </Hint>
            </div>
            <LaneBoardHeader head={workspace.head} id={boardHeadingId} />
          </SidebarHeader>
          {desktopSidebar ? (
            <SidebarContent
              aria-label={t("run.title")}
              className="w-88"
              inert={!sidebarOpen}
              ref={sidebarPanel}
            >
              {configurationContents}
            </SidebarContent>
          ) : null}
          <section
            aria-busy={isPending || undefined}
            aria-labelledby={boardHeadingId}
            className="col-start-2 row-start-2 min-w-0 data-pending:pointer-events-none data-pending:animate-pulse motion-reduce:animate-none"
            data-pending={isPending || undefined}
          >
            <LaneBoard
              brands={options.brands}
              defaultModelOptionKey={defaultModelOptionKey}
              freshWorkspace={
                workspace.head === null && workspace.query.run === null
              }
              head={workspace.head}
              limitedGuidanceBrands={limitedGuidanceBrands}
              models={options.models}
              modelLanes={workspace.modelLanes}
              onOpenCard={(card, trigger) => {
                setFinalFocus(trigger);
                const active =
                  card.revisions.find(
                    (revision) => revision.id === card.activeRevisionId,
                  ) ?? card.revisions.at(-1);
                if (active) {
                  pinCard({
                    contentLocale: active.contentLocale,
                    copy: active.body,
                    draftId: card.id,
                    headline: active.headline,
                    platform: card.platform,
                  });
                }
                void setValues({ draft: card.id });
              }}
              platformDraftLanes={platformDraftLanes}
              presentation={presentation}
              templatePlatforms={templatePlatforms}
              telegramLanes={workspace.telegramLanes}
            />
            <span className="sr-only" role="status">
              {isPending ? t("run.selector.updating") : ""}
            </span>
          </section>
        </Sidebar>
        {desktopSidebar ? null : (
          <SheetPortal dir={direction} keepMounted>
            <SheetOverlay />
            <SheetViewport side="inline-start">
              <SheetPopup
                className="w-full border-0 bg-sidebar text-sidebar-foreground [--sheet-padding:--spacing(3)]"
                direction={direction}
                finalFocus={sidebarTrigger}
                inert={!mobileSidebarOpen}
                initialFocus={mobileSidebarOpen ? sidebarClose : false}
                side="inline-start"
              >
                <SheetTitle className="sr-only">{t("run.title")}</SheetTitle>
                <div className="sticky top-0 z-10 -mx-3 -mt-3 flex items-center justify-between gap-3 border-sidebar-border border-b bg-sidebar px-3 pt-3 pb-3">
                  <span className="font-medium text-sm">{t("run.title")}</span>
                  <SheetClose
                    aria-label={t("run.closeConfiguration")}
                    ref={sidebarClose}
                    render={
                      <Button
                        className="size-11 shrink-0 p-0"
                        size="icon"
                        variant="outline"
                      />
                    }
                  >
                    <XIcon aria-hidden="true" />
                  </SheetClose>
                </div>
                {configurationContents}
              </SheetPopup>
            </SheetViewport>
          </SheetPortal>
        )}
      </Sheet>
      <CardSheet
        card={selectedDraft ?? null}
        finalFocus={finalFocus}
        models={options.models}
        freshness={
          workspace.head
            ? {
                analysisRunId: workspace.head.id,
                readAt: workspace.readAt,
              }
            : undefined
        }
        imageModels={imageModels}
        onOpenChange={(open) => {
          if (!open) {
            void setValues({ draft: null });
          }
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
  if (head) {
    return configuredBoardPresentation(head.configuration, templatePlatforms);
  }

  return {
    brandKeys: options.defaults.brands,
    kind: "news",
    modelKeys: options.defaults.models,
    platforms: options.defaults.platforms,
    telegramOnly: false,
  };
}
