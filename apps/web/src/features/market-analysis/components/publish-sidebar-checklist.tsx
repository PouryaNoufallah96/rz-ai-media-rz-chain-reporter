"use client";

import { useTranslations } from "next-intl";

import { PlatformIcon } from "@/components/common/platform-icon";
import { StateMark } from "@/components/common/state-mark";
import { EDITORIAL_NAMESPACE } from "@/features/editorial/constants";

import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { hasThreeReadyCaptions } from "../lib/publish-readiness";
import type { MarketAnalysisProjection } from "../schemas/reads";

export function PublishSidebarChecklist({
  analysis,
}: {
  analysis: MarketAnalysisProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const editorialT = useTranslations(EDITORIAL_NAMESPACE);
  const cards = analysis.platformDrafts;
  const imageApproved = Boolean(analysis.approvals.final.fingerprint);
  const captionSelected = cards.some((card) => card.revisions.length > 0);
  const platformReady = cards.some(hasThreeReadyCaptions);
  const ready = imageApproved && captionSelected && platformReady;
  const platformLabel = cards[0]
    ? editorialT(`run.platform.${cards[0].platform}`)
    : t("publish.platform");
  const checks = [
    { done: imageApproved, key: "image", label: t("publish.checkImage") },
    { done: captionSelected, key: "caption", label: t("publish.checkCaption") },
    {
      done: platformReady,
      key: "platform",
      label: (
        <span className="inline-flex items-center gap-1.5">
          {cards[0] ? (
            <PlatformIcon className="size-3.5" platform={cards[0].platform} />
          ) : null}
          {t("publish.checkPlatform", { platform: platformLabel })}
        </span>
      ),
    },
  ];
  return (
    <div className="grid min-w-0 gap-2 border-t pt-4 text-xs">
      {checks.map((check) => (
        <div className="flex min-w-0 items-start gap-2" key={check.key}>
          <StateMark state={check.done ? "succeeded" : "queued"} />
          <span className="min-w-0">{check.label}</span>
        </div>
      ))}
      <div className="flex min-w-0 items-center justify-between gap-2 border-t pt-2">
        <span className="text-muted-foreground">{t("publish.readyTitle")}</span>
        <span className="font-medium">
          {t(ready ? "publish.readyYes" : "publish.readyNo")}
        </span>
      </div>
    </div>
  );
}
