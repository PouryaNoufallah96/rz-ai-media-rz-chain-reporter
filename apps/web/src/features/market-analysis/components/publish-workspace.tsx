"use client";

import type { Platform } from "@rz-chain-reporter/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { BackgroundGradient } from "@rz-chain-reporter/ui/components/background-gradient";
import { AlertTriangleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useAction } from "@/hooks/use-action";

import { finishMarketAnalysisAction } from "../actions/commands";
import { prepareMarketPlatformAction } from "../actions/prepare-platform";
import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { useMarketActionError } from "../hooks/use-market-action-error";
import type {
  MarketAnalysisOptionsProjection,
  MarketAnalysisProjection,
} from "../schemas/reads";
import { AnalysisFooter } from "./analysis-footer";
import { DraftWorkspace } from "./draft-workspace";
import { PublishSetup } from "./publish-setup";

export function PublishWorkspace({
  analysis,
  onBack,
  onDirtyChange,
  options,
}: {
  analysis: MarketAnalysisProjection;
  onBack?: () => void;
  onDirtyChange: (dirty: boolean) => void;
  options: MarketAnalysisOptionsProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const resolveError = useMarketActionError();
  const prepare = useAction(prepareMarketPlatformAction);
  const finish = useAction(finishMarketAnalysisAction);
  const platforms = analysis.eligiblePlatforms;
  const drafts = new Map(
    analysis.platformDrafts.map((card) => [card.platform, card]),
  );
  const [platform, setPlatform] = useState<Platform | undefined>(
    () => analysis.platformDrafts[0]?.platform ?? platforms[0],
  );
  const [modelOptionKey, setModelOptionKey] = useState(
    () =>
      analysis.platformDrafts[0]?.candidates[0]?.modelOptionKey ??
      options.defaultCopyModelOptionKey,
  );
  const [dirtyDraftIds, setDirtyDraftIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingDraftIds, setPendingDraftIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const selectedCard = platform ? drafts.get(platform) : undefined;
  const busy = prepare.isPending || finish.isPending;
  const finishBlocked =
    busy || dirtyDraftIds.size > 0 || pendingDraftIds.size > 0;

  const changeDraftState = (
    setter: typeof setDirtyDraftIds,
    id: string,
    active: boolean,
  ) => {
    setter((current) => {
      const next = new Set(current);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const changePlatform = (next: Platform) => {
    if (next === platform) return;
    setDirtyDraftIds(new Set());
    setPendingDraftIds(new Set());
    onDirtyChange(false);
    setPlatform(next);
  };

  const preparePlatform = async () => {
    if (!platform || selectedCard) return;
    prepare.reset();
    finish.reset();
    await prepare.execute({
      analysisId: analysis.id,
      idempotencyKey: crypto.randomUUID(),
      modelOptionKey,
      platform,
    });
  };

  const finishAnalysis = async () => {
    finish.reset();
    prepare.reset();
    await finish.execute({
      analysisId: analysis.id,
      expectedVersion: analysis.version,
    });
  };

  const setup = (
    <PublishSetup
      busy={busy}
      modelOptionKey={modelOptionKey}
      models={options.copyModels}
      onModelOptionChange={setModelOptionKey}
      onPlatformChange={changePlatform}
      onPrepare={() => void preparePlatform()}
      platform={platform}
      platforms={platforms}
      prepareError={prepare.status === "error" ? prepare.code : undefined}
      preparing={prepare.isPending}
      resolveError={resolveError}
      selectedCard={selectedCard}
    />
  );

  return (
    <>
      <div className="grid min-w-0 gap-5">
        {selectedCard ? (
          <DraftWorkspace
            analysisId={analysis.id}
            analysisVersion={analysis.version}
            card={selectedCard}
            key={selectedCard.id}
            modelOptionKey={modelOptionKey}
            setup={setup}
            onDirtyChange={(dirty) => {
              changeDraftState(setDirtyDraftIds, selectedCard.id, dirty);
              onDirtyChange(dirty);
            }}
            onPendingChange={(pending) =>
              changeDraftState(setPendingDraftIds, selectedCard.id, pending)
            }
          />
        ) : (
          <BackgroundGradient
            className="grid min-w-0 gap-4 p-4"
            containerClassName="min-w-0"
          >
            {setup}
          </BackgroundGradient>
        )}
        {finish.status === "error" ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("publish.finishFailedTitle")}</AlertTitle>
            <AlertDescription>
              {resolveError(finish.code)} {t("publish.finishFailedBody")}
            </AlertDescription>
          </Alert>
        ) : null}
        {(dirtyDraftIds.size > 0 || pendingDraftIds.size > 0) &&
        !finish.isPending ? (
          <p className="text-muted-foreground text-sm">
            {t("publish.finishBlocked")}
          </p>
        ) : null}
      </div>
      <AnalysisFooter
        disabled={finishBlocked}
        onBack={onBack}
        onPrimary={() => void finishAnalysis()}
        pending={finish.isPending}
        pendingLabel={t("publish.finishing")}
        primaryLabel={t("actions.finish")}
      />
    </>
  );
}
