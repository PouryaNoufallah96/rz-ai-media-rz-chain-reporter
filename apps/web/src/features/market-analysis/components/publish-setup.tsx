"use client";

import type { Platform } from "@rz-chain-reporter/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Field, FieldLegend } from "@rz-chain-reporter/ui/components/field";
import { Hint } from "@rz-chain-reporter/ui/components/hint";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@rz-chain-reporter/ui/components/toggle-group";
import { AlertTriangleIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { ModelIcon } from "@/components/common/model-icon";
import { PlatformIcon } from "@/components/common/platform-icon";
import { StateMark } from "@/components/common/state-mark";
import { EDITORIAL_NAMESPACE } from "@/features/editorial/constants";
import type { PlatformDraftExactCard } from "@/features/editorial/schemas/drafts";

import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { hasThreeReadyCaptions } from "../lib/publish-readiness";
import type { MarketAnalysisOptionsProjection } from "../schemas/reads";

export function PublishSetup({
  busy,
  disabledPlatforms,
  modelOptionKey,
  models,
  onModelOptionChange,
  onPlatformChange,
  onPrepare,
  platform,
  platforms,
  prepareError,
  preparing,
  resolveError,
  selectedCard,
}: {
  busy: boolean;
  disabledPlatforms?: ReadonlySet<Platform>;
  modelOptionKey: string;
  models: MarketAnalysisOptionsProjection["copyModels"];
  onModelOptionChange: (modelOptionKey: string) => void;
  onPlatformChange: (platform: Platform) => void;
  onPrepare: () => void;
  platform: Platform | undefined;
  platforms: readonly Platform[];
  prepareError: string | undefined;
  preparing: boolean;
  resolveError: (code: string | undefined) => string;
  selectedCard: PlatformDraftExactCard | undefined;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const editorialT = useTranslations(EDITORIAL_NAMESPACE);
  const readyCount = Math.min(selectedCard?.candidates.length ?? 0, 3);
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-end gap-4">
        <Field className="w-auto">
          <FieldLegend className="ticket-label mb-2" variant="label">
            {t("publish.platform")}
          </FieldLegend>
          <ToggleGroup
            onValueChange={(next) => {
              const value = next.at(-1);
              const chosen = platforms.find((candidate) => candidate === value);
              if (!chosen || disabledPlatforms?.has(chosen)) return;
              onPlatformChange(chosen);
            }}
            value={platform ? [platform] : []}
          >
            {platforms.map((candidate) => {
              const name = editorialT(`run.platform.${candidate}`);
              const prepared = disabledPlatforms?.has(candidate) ?? false;
              const label = prepared
                ? t("report.platformAlreadyPrepared", { platform: name })
                : name;
              return (
                <Hint key={candidate} label={label}>
                  <ToggleGroupItem
                    aria-label={label}
                    className="min-h-7 min-w-7 px-0"
                    disabled={prepared}
                    value={candidate}
                  >
                    <PlatformIcon className="size-4" platform={candidate} />
                  </ToggleGroupItem>
                </Hint>
              );
            })}
          </ToggleGroup>
        </Field>
        <Field className="w-auto" disabled={busy}>
          <FieldLegend className="ticket-label mb-2" variant="label">
            {t("publish.model")}
          </FieldLegend>
          <ToggleGroup
            onValueChange={(next) => {
              const value = next.at(-1);
              if (value) onModelOptionChange(value);
            }}
            value={[modelOptionKey]}
          >
            {models.map((model) => (
              <Hint key={model.key} label={model.name}>
                <ToggleGroupItem
                  aria-label={model.name}
                  className="min-h-7 min-w-7 px-0"
                  value={model.key}
                >
                  <ModelIcon className="size-4" vendor={model.vendor} />
                </ToggleGroupItem>
              </Hint>
            ))}
          </ToggleGroup>
        </Field>
        {selectedCard ? (
          <p className="ms-auto flex min-h-8 items-center gap-1.5 text-muted-foreground text-sm">
            <StateMark
              state={
                hasThreeReadyCaptions(selectedCard)
                  ? "succeeded"
                  : selectedCard.generation?.lifecycle === "failed"
                    ? "failed"
                    : "running"
              }
            />
            {t("publish.captionProgress", { ready: readyCount })}
          </p>
        ) : (
          <Button
            className="ms-auto"
            disabled={busy || !platform}
            onClick={onPrepare}
            type="button"
          >
            {preparing ? (
              <Spinner
                data-icon="inline-start"
                label={t("publish.preparing")}
              />
            ) : null}
            {t("publish.generateCaptions")}
          </Button>
        )}
      </div>
      {prepareError ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("publish.prepareFailedTitle")}</AlertTitle>
          <AlertDescription>
            {resolveError(prepareError)} {t("publish.prepareFailedBody")}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
