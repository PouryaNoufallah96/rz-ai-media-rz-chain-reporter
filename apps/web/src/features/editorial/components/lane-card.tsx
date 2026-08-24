"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Sheet, SheetTrigger } from "@rz-chain-reporter/ui/components/sheet";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { EDITORIAL_NAMESPACE } from "../constants";
import type {
  PromoIdeaCard,
  SelectionCard,
  TelegramCard,
} from "../schemas/workspace";
import {
  CardDetailsSheet,
  PromoDetails,
  perSourceOrdering,
  SelectionDetails,
  TelegramDetails,
} from "./card-details-sheet";
import { ChannelPlate } from "./channel-plate";
import { FallbackTag, MutedTag, ProvenanceLine } from "./provenance-line";
import { SHORT_ID_LENGTH } from "./run-selector";

type Translate = ReturnType<typeof useTranslations<typeof EDITORIAL_NAMESPACE>>;

function LaneCard({
  children,
  details,
  title,
}: {
  children: ReactNode;
  details: ReactNode;
  title: string;
}) {
  return (
    <Sheet>
      <SheetTrigger className="fade-in zoom-in-95 grid w-full animate-in gap-1 border-border border-b border-dashed px-2 py-3 text-start hover:bg-accent motion-reduce:animate-none">
        {children}
      </SheetTrigger>
      <CardDetailsSheet title={title}>{details}</CardDetailsSheet>
    </Sheet>
  );
}

export function SelectionLaneCard({
  card,
  degraded,
  fallback,
}: {
  card: SelectionCard;
  degraded: boolean;
  fallback: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <LaneCard details={<SelectionDetails card={card} />} title={card.title}>
      <p className="line-clamp-2 text-sm">
        <Bdi>{card.title}</Bdi>
      </p>
      <p className="line-clamp-1 text-muted-foreground text-xs">
        <Bdi>{card.sourceName}</Bdi>
      </p>
      <ProvenanceLine segments={[t("card.rank", { n: card.rank })]}>
        {fallback ? (
          <FallbackTag
            detail={t("lane.fallback.detail")}
            tag={t("lane.fallback.tag")}
          />
        ) : null}
        {degraded ? (
          <MutedTag>{t("semantic.deterministicOrder")}</MutedTag>
        ) : null}
      </ProvenanceLine>
    </LaneCard>
  );
}

export function PromoLaneCard({
  brandName,
  card,
  fallback,
  limitedGuidance,
  modelOptionKey,
  runId,
  unitId,
}: {
  brandName: string;
  card: PromoIdeaCard;
  fallback: boolean;
  limitedGuidance: boolean;
  modelOptionKey: string;
  runId: string;
  unitId: string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <LaneCard
      details={
        <PromoDetails
          brandName={brandName}
          card={card}
          limitedGuidance={limitedGuidance}
        />
      }
      title={card.title}
    >
      <p className="line-clamp-2 text-sm">
        <Bdi>{card.title}</Bdi>
      </p>
      <p className="line-clamp-2 text-muted-foreground text-xs">
        <Bdi>{card.description}</Bdi>
      </p>
      <ProvenanceLine
        segments={[
          t("provenance.run", { id: runId.slice(0, SHORT_ID_LENGTH) }),
          modelOptionKey,
          t("promo.unit", { id: unitId.slice(0, SHORT_ID_LENGTH) }),
        ]}
      >
        {fallback ? (
          <FallbackTag
            detail={t("lane.fallback.detail")}
            tag={t("lane.fallback.tag")}
          />
        ) : null}
      </ProvenanceLine>
    </LaneCard>
  );
}

export function TelegramLaneCard({
  alsoIn,
  card,
  degraded,
  topics,
}: {
  alsoIn: readonly string[];
  card: TelegramCard;
  degraded: boolean;
  topics: readonly string[];
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <LaneCard
      details={<TelegramDetails alsoIn={alsoIn} card={card} topics={topics} />}
      title={card.title}
    >
      <ChannelPlate handle={card.channelHandle} />
      <p className="line-clamp-2 text-sm">
        <Bdi>{card.title}</Bdi>
      </p>
      <ProvenanceLine
        segments={telegramSegments(
          card,
          alsoIn.length > 0 ? format.list(alsoIn) : null,
          t,
        )}
      >
        {card.semanticParticipation === "outside_bound" ? (
          <MutedTag>{t("semantic.outsideBound.tag")}</MutedTag>
        ) : null}
        {degraded ? (
          <MutedTag>{t("semantic.deterministicOrder")}</MutedTag>
        ) : null}
        {card.duplicateRssCount > 0 ? (
          <MutedTag>
            {t("telegram.duplicateRss", { n: card.duplicateRssCount })}
          </MutedTag>
        ) : null}
      </ProvenanceLine>
    </LaneCard>
  );
}

function telegramSegments(
  card: TelegramCard,
  alsoIn: string | null,
  t: Translate,
) {
  const segments = [t(`run.telegram.ordering.${card.orderingMode}`)];

  if (card.sourceRank !== null) {
    segments.push(
      perSourceOrdering(card.orderingMode)
        ? t("telegram.sourceOrderRank.perSource", {
            channel: `@${card.channelHandle}`,
            n: card.sourceRank,
          })
        : t("telegram.sourceOrderRank.global", { n: card.sourceRank }),
    );
  }
  if (card.orderingMode === "keywords" && card.keywordScore !== null) {
    segments.push(t("telegram.semanticScore", { value: card.keywordScore }));
  }
  if (card.views !== null) {
    segments.push(t("telegram.observedViews.value", { n: card.views }));
  }
  if (card.rankPosition !== null) {
    segments.push(t("telegram.brandRouteRank.value", { n: card.rankPosition }));
  }
  if (alsoIn !== null) {
    segments.push(t("telegram.alsoIn.value", { brands: alsoIn }));
  }

  return segments;
}
