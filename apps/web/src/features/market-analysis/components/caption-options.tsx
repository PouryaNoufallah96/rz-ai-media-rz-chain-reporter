"use client";

import {
  assembleCopy,
  PLATFORM_COPY_HARD_MAX,
  platformCopyLength,
} from "@rz-chain-reporter/contracts";
import { DIRECTION } from "@rz-chain-reporter/i18n";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  RadioGroup,
  RadioGroupItem,
} from "@rz-chain-reporter/ui/components/radio-group";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { useTranslations } from "next-intl";
import { useId } from "react";

import type { PlatformDraftExactCard } from "@/features/editorial/schemas/drafts";

import { MARKET_ANALYSIS_NAMESPACE } from "../constants";

export const CAPTION_EDITOR_ID = "market-caption-editor";

const CAPTION_TILE_CLASS_NAME =
  "grid min-h-full min-w-0 content-start gap-2 rounded-xl border p-3 pe-14";

type CaptionCard = Pick<
  PlatformDraftExactCard,
  "candidates" | "id" | "platform"
>;

export function CaptionOptions({
  card,
  disabled,
  generating,
  onSelect,
  selectedId,
}: {
  card: CaptionCard;
  disabled: boolean;
  generating: boolean;
  onSelect: (candidate: CaptionCard["candidates"][number]) => void;
  selectedId: string | null;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const tileId = useId();
  if (generating) {
    return (
      <div
        aria-busy
        className="grid min-w-0 compact:grid-cols-3 gap-2"
        role="status"
      >
        <span className="sr-only">{t("publish.captionsPreparing")}</span>
        {[0, 1, 2].map((row) => (
          <div aria-hidden="true" className={CAPTION_TILE_CLASS_NAME} key={row}>
            <div className="flex items-center gap-2">
              <Skeleton className="size-4 rounded-full" pace="live" />
              <Skeleton className="h-4 w-20" pace="live" />
              <Skeleton className="ms-auto h-3 w-14" pace="live" />
            </div>
            <Skeleton className="h-3 w-full" pace="live" />
            <Skeleton className="h-3 w-2/3" pace="live" />
          </div>
        ))}
      </div>
    );
  }
  const limit = PLATFORM_COPY_HARD_MAX[card.platform];
  return (
    <RadioGroup
      aria-label={t("publish.optionsTitle")}
      className="grid min-w-0 compact:grid-cols-3 gap-2"
      disabled={disabled}
      onValueChange={(next) => {
        const candidate = card.candidates.find((item) => item.id === next);
        if (candidate) onSelect(candidate);
      }}
      value={selectedId}
    >
      {card.candidates.slice(0, 3).map((candidate, index) => {
        const label = t("publish.captionNumber", { number: index + 1 });
        const controlId = `${tileId}-${index}`;
        const used = platformCopyLength(
          card.platform,
          assembleCopy(card.platform, {
            body: candidate.body.trim(),
            hashtags: candidate.hashtags,
            headline: candidate.headline.trim(),
          }),
        );
        return (
          <div className="relative min-w-0" key={candidate.id}>
            <label
              htmlFor={controlId}
              className={`${CAPTION_TILE_CLASS_NAME} cursor-pointer transition-colors has-disabled:cursor-not-allowed has-data-checked:border-primary/40 has-data-checked:bg-accent`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <RadioGroupItem
                  aria-label={label}
                  id={controlId}
                  value={candidate.id}
                />
                <span className="font-medium text-sm">{label}</span>
                <span
                  className={
                    used > limit
                      ? "ms-auto text-caution text-xs tabular-nums"
                      : "ms-auto text-muted-foreground text-xs tabular-nums"
                  }
                >
                  <Bdi>{t("publish.counter", { count: used, max: limit })}</Bdi>
                </span>
              </span>
              <Bdi
                className="line-clamp-2 text-muted-foreground text-xs"
                dir={DIRECTION[candidate.contentLocale]}
                lang={candidate.contentLocale}
              >
                {candidate.headline}
              </Bdi>
            </label>
            <Button
              className="absolute end-2 top-2"
              disabled={disabled}
              nativeButton={false}
              onClick={() => onSelect(candidate)}
              render={
                <a
                  aria-label={t("publish.editCaption")}
                  href={`#${CAPTION_EDITOR_ID}`}
                />
              }
              size="xs"
              variant="ghost"
            >
              {t("publish.editCaption")}
            </Button>
          </div>
        );
      })}
    </RadioGroup>
  );
}
