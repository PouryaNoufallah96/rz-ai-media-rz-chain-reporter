"use client";

import type {
  MarketExecutionScopeTarget,
  ModelOption,
  OperationLifecycle,
  Platform,
} from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rz-chain-reporter/ui/components/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type MouseEvent, startTransition, useState } from "react";

import { PlatformIcon } from "@/components/common/platform-icon";
import { CardSheet } from "@/features/editorial/components/card-sheet";
import type { PlatformDraftExactCard } from "@/features/editorial/schemas/drafts";
import type { RunOptions } from "@/features/editorial/schemas/workspace";
import { useAction } from "@/hooks/use-action";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";

import { prepareMarketPlatformAction } from "../actions/prepare-platform";
import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { useMarketActionError } from "../hooks/use-market-action-error";
import type {
  MarketAnalysisOptionsProjection,
  MarketAnalysisReportLive,
} from "../schemas/reads";
import {
  type AnalysisReportQuery,
  analysisReportSearchParsers,
  normalizeAnalysisReportQuery,
} from "../schemas/search";
import { MarketAnalysisFreshness } from "./market-analysis-freshness";
import { PublishSetup } from "./publish-setup";

type Handoff = MarketAnalysisReportLive["handoffs"][number];
type HandoffDraft = Handoff["drafts"][number];

type ReportSelectedDraft = {
  executionScope: MarketExecutionScopeTarget;
  lifecycle: OperationLifecycle;
  card: PlatformDraftExactCard;
  readAt: Date;
} | null;

export function ReportPublishing({
  analysisId,
  copyModels,
  defaultCopyModelOptionKey,
  handoffs,
  imageModels,
  models,
  platforms,
  query,
  selectedDraft,
}: {
  analysisId: string;
  copyModels: MarketAnalysisOptionsProjection["copyModels"];
  defaultCopyModelOptionKey: string;
  handoffs: readonly Handoff[];
  imageModels: readonly ModelOption[];
  models: RunOptions["models"];
  platforms: readonly Platform[];
  query: AnalysisReportQuery;
  selectedDraft: ReportSelectedDraft;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const { setValues, values } = useTransitionUrlState(
    analysisReportSearchParsers,
  );
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const selectedDraftId = normalizeAnalysisReportQuery(values).draft;
  const card =
    selectedDraft?.card.id === selectedDraftId ? selectedDraft.card : null;
  const preparedPlatforms = new Set(
    handoffs.flatMap((handoff) =>
      handoff.classification === "final_completed_chain"
        ? handoff.drafts.map((draft) => draft.platform)
        : [],
    ),
  );
  const openPlatforms = platforms.filter(
    (platform) => !preparedPlatforms.has(platform),
  );
  const openDraft = (
    event: MouseEvent<HTMLButtonElement>,
    platformDraftId: string,
  ) => {
    setOpener(event.currentTarget);
    void setValues({ draft: platformDraftId }, { startTransition });
  };

  return (
    <>
      {handoffs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
          {t("report.noHandoffs")}
        </p>
      ) : (
        <div className="grid gap-3">
          {handoffs.map((handoff) => (
            <HandoffGroup
              handoff={handoff}
              key={handoff.id}
              onOpenDraft={openDraft}
            />
          ))}
        </div>
      )}
      {openPlatforms.length > 0 ? (
        <PreparePlatform
          analysisId={analysisId}
          copyModels={copyModels}
          defaultCopyModelOptionKey={defaultCopyModelOptionKey}
          disabledPlatforms={preparedPlatforms}
          onPrepared={(draftId) =>
            void setValues({ draft: draftId }, { startTransition })
          }
          platforms={platforms}
        />
      ) : null}
      <CardSheet
        card={card}
        finalFocus={opener?.isConnected ? opener : null}
        imageModels={imageModels}
        loading={selectedDraftId !== null && selectedDraftId !== query.draft}
        models={models}
        onOpenChange={(open) => {
          if (!open) void setValues({ draft: null }, { startTransition });
        }}
        open={selectedDraftId !== null}
      />
      {card?.executionScope.kind === "market_analysis" ? (
        <MarketAnalysisFreshness
          analysisId={card.executionScope.marketAnalysisId}
        />
      ) : null}
    </>
  );
}

function PreparePlatform({
  analysisId,
  copyModels,
  defaultCopyModelOptionKey,
  disabledPlatforms,
  onPrepared,
  platforms,
}: {
  analysisId: string;
  copyModels: MarketAnalysisOptionsProjection["copyModels"];
  defaultCopyModelOptionKey: string;
  disabledPlatforms: ReadonlySet<Platform>;
  onPrepared: (draftId: string) => void;
  platforms: readonly Platform[];
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const resolveError = useMarketActionError();
  const prepare = useAction(prepareMarketPlatformAction);
  const openPlatforms = platforms.filter(
    (candidate) => !disabledPlatforms.has(candidate),
  );
  const [platform, setPlatform] = useState<Platform | undefined>(
    () => openPlatforms[0],
  );
  const [modelOptionKey, setModelOptionKey] = useState(
    defaultCopyModelOptionKey,
  );
  const selected =
    platform && openPlatforms.includes(platform) ? platform : openPlatforms[0];

  const preparePlatform = async () => {
    if (!selected) return;
    prepare.reset();
    const settled = await prepare.execute({
      analysisId,
      idempotencyKey: crypto.randomUUID(),
      modelOptionKey,
      platform: selected,
    });
    if (settled.data?.draftId) onPrepared(settled.data.draftId);
  };

  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <div>
        <h3 className="font-medium text-sm">{t("report.prepareAnother")}</h3>
        <p className="text-muted-foreground text-xs">
          {t("report.prepareAnotherBody")}
        </p>
      </div>
      <PublishSetup
        busy={prepare.isPending}
        disabledPlatforms={disabledPlatforms}
        modelOptionKey={modelOptionKey}
        models={copyModels}
        onModelOptionChange={setModelOptionKey}
        onPlatformChange={setPlatform}
        onPrepare={() => void preparePlatform()}
        platform={selected}
        platforms={platforms}
        prepareError={prepare.status === "error" ? prepare.code : undefined}
        preparing={prepare.isPending}
        resolveError={resolveError}
        selectedCard={undefined}
      />
    </div>
  );
}

function HandoffGroup({
  handoff,
  onOpenDraft,
}: {
  handoff: Handoff;
  onOpenDraft: (event: MouseEvent<HTMLButtonElement>, id: string) => void;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const editorialT = useTranslations("editorial");
  const format = useFormatter();
  return (
    <Collapsible
      className="rounded-lg border"
      defaultOpen={handoff.classification === "final_completed_chain"}
    >
      <CollapsibleTrigger
        render={
          <Button
            className="group h-auto w-full justify-between whitespace-normal px-3 py-2.5 text-start"
            variant="ghost"
          />
        }
      >
        <span className="font-medium text-sm">
          {t(`report.classification.${handoff.classification}`)}
          <span aria-hidden="true"> · </span>
          <time
            className="font-normal text-muted-foreground"
            dateTime={handoff.createdAt.toISOString()}
          >
            {format.dateTime(handoff.createdAt, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-2 border-t p-2">
        {handoff.drafts.map((draft) => (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-sm"
            key={draft.id}
          >
            <span className="inline-flex items-center gap-1.5 font-medium">
              <PlatformIcon className="size-3.5" platform={draft.platform} />
              {editorialT(`run.platform.${draft.platform}`)}
            </span>
            <span className="text-muted-foreground">
              {t("report.revision", { revision: draft.revisionNumber ?? 0 })}
            </span>
            <span className="text-muted-foreground">
              {draft.saved ? t("report.saved") : t("report.notSaved")}
            </span>
            <span className="text-muted-foreground">
              {draft.destinationReady
                ? t("report.destinationReady")
                : t("report.destinationUnavailable")}
            </span>
            <span
              className={draft.deliveryUnknown ? "text-caution" : undefined}
            >
              {t(`report.deliveryState.${deliveryState(draft)}`)}
            </span>
            <Button
              className="ms-auto"
              onClick={(event) => onOpenDraft(event, draft.id)}
              size="xs"
              type="button"
              variant="outline"
            >
              {t("report.openDraft")}
            </Button>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function deliveryState(draft: HandoffDraft) {
  if (draft.deliveryUnknown) return "deliveryUnknown";
  if (draft.publicationLifecycle === "confirmed") return "confirmed";
  if (draft.scheduleLifecycle === "scheduled") return "scheduled";
  if (
    draft.publicationLifecycle === "failed" ||
    draft.scheduleLifecycle === "failed" ||
    draft.scheduleLifecycle === "missed_requires_confirmation"
  ) {
    return "failed";
  }
  if (
    draft.scheduleLifecycle === "cancelled" ||
    draft.scheduleLifecycle === "rescheduled"
  ) {
    return "notPublished";
  }
  if (draft.publicationLifecycle || draft.scheduleLifecycle) {
    return "inProgress";
  }
  return "notPublished";
}
