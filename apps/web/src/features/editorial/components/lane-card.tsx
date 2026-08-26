"use client";

import { useDraggable } from "@dnd-kit/react";
import type {
  CardOriginReference,
  ContentLocale,
} from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Sheet, SheetTrigger } from "@rz-chain-reporter/ui/components/sheet";
import { GripVerticalIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { EDITORIAL_NAMESPACE } from "../constants";
import type { PlatformDraftCard } from "../schemas/drafts";
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
import { CardSheet } from "./card-sheet";
import { ChannelPlate } from "./channel-plate";
import {
  type OriginDragData,
  originKey,
  useRouteContext,
} from "./platform-lane";
import { FallbackTag, MutedTag, ProvenanceLine } from "./provenance-line";
import { SHORT_ID_LENGTH } from "./run-selector";

type Translate = ReturnType<typeof useTranslations<typeof EDITORIAL_NAMESPACE>>;

const CARD_CLASS =
  "fade-in zoom-in-95 grid animate-in gap-2 border-border border-b border-dashed bg-card px-2 py-3 data-[dragging]:opacity-70 data-[dragging]:shadow-lg data-[dragging]:ring-2 data-[dragging]:ring-ring motion-reduce:animate-none";

function LaneCard({
  children,
  details,
  drag,
  route,
  title,
}: {
  children: ReactNode;
  details: ReactNode;
  drag: OriginDragData;
  route: ReactNode;
  title: string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const id = originKey(drag.origin);
  const { handleRef, isDragging, ref } = useDraggable<OriginDragData>({
    data: drag,
    id: `origin-${id}`,
    type: "origin",
  });

  return (
    <article
      className={CARD_CLASS}
      data-dragging={isDragging || undefined}
      ref={ref}
    >
      <Sheet>
        <SheetTrigger
          render={
            <Button
              className="grid h-auto w-full min-w-0 justify-normal gap-1 whitespace-normal px-0 py-1 text-start font-normal"
              type="button"
              variant="ghost"
            />
          }
        >
          {children}
        </SheetTrigger>
        <CardDetailsSheet title={title}>{details}</CardDetailsSheet>
      </Sheet>
      <div className="flex flex-wrap items-start gap-2">
        <Button
          aria-label={t("platformDraft.dragOrigin", { title: drag.title })}
          id={`origin-handle-${id}`}
          ref={handleRef}
          size="icon"
          type="button"
          variant="ghost"
        >
          <GripVerticalIcon aria-hidden="true" />
        </Button>
        {route}
      </div>
    </article>
  );
}

export function PlatformDraftLaneCard({
  card,
  dragHandle,
  siblingRoutes,
}: {
  card: PlatformDraftCard;
  dragHandle: ReactNode;
  siblingRoutes: ReactNode;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const completed =
    card.generation?.units.filter((unit) => unit.status === "succeeded")
      .length ?? 0;
  const total = card.generation?.units.length ?? 0;

  return (
    <article className="grid gap-2 border-border border-b border-dashed px-2 py-3">
      <div className="flex min-w-0 items-start gap-2">
        <CardSheet card={card}>
          <span className="line-clamp-2 text-sm">
            <Bdi>{card.originTitle}</Bdi>
          </span>
          <ProvenanceLine
            segments={[
              t("platformDraft.position", { n: card.lanePosition }),
              card.generation
                ? t(`platformDraft.lifecycle.${card.generation.lifecycle}`)
                : t("platformDraft.lifecycle.queued"),
              t("platformDraft.units", { completed, total }),
            ]}
          />
        </CardSheet>
        {dragHandle}
      </div>
      <div className="flex flex-wrap items-start gap-2">{siblingRoutes}</div>
    </article>
  );
}

export function SelectionLaneCard({
  brandKey,
  card,
  degraded,
  fallback,
}: {
  brandKey: string;
  card: SelectionCard;
  degraded: boolean;
  fallback: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const uiLocale = useLocale();

  return (
    <LaneCard
      details={<SelectionDetails card={card} />}
      drag={{
        kind: "origin",
        brandKey,
        contentLocale: uiLocale,
        origin: {
          kind: "editorial_selection",
          editorialSelectionId: card.id,
        },
        title: card.title,
      }}
      route={
        <SendToPlatforms
          cardId={card.id}
          contentLocale={uiLocale}
          origin={{
            kind: "editorial_selection",
            editorialSelectionId: card.id,
          }}
        />
      }
      title={card.title}
    >
      <span className="line-clamp-2 text-sm">
        <Bdi>{card.title}</Bdi>
      </span>
      <span className="line-clamp-1 text-muted-foreground text-xs">
        <Bdi>{card.sourceName}</Bdi>
      </span>
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
  brandKey,
  brandName,
  card,
  fallback,
  limitedGuidance,
  modelOptionKey,
  runId,
  unitId,
}: {
  brandKey: string;
  brandName: string;
  card: PromoIdeaCard;
  fallback: boolean;
  limitedGuidance: boolean;
  modelOptionKey: string;
  runId: string;
  unitId: string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const uiLocale = useLocale();

  return (
    <LaneCard
      details={
        <PromoDetails
          brandName={brandName}
          card={card}
          limitedGuidance={limitedGuidance}
        />
      }
      drag={{
        kind: "origin",
        brandKey,
        contentLocale: uiLocale,
        origin: { kind: "promo_idea", promoIdeaId: card.id },
        title: card.title,
      }}
      title={card.title}
      route={
        <SendToPlatforms
          cardId={card.id}
          contentLocale={uiLocale}
          origin={{ kind: "promo_idea", promoIdeaId: card.id }}
        />
      }
    >
      <span className="line-clamp-2 text-sm">
        <Bdi>{card.title}</Bdi>
      </span>
      <span className="line-clamp-2 text-muted-foreground text-xs">
        <Bdi>{card.description}</Bdi>
      </span>
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
  brandKey,
  card,
  degraded,
  topics,
}: {
  alsoIn: readonly string[];
  brandKey: string;
  card: TelegramCard;
  degraded: boolean;
  topics: readonly string[];
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const uiLocale = useLocale();

  return (
    <LaneCard
      details={<TelegramDetails alsoIn={alsoIn} card={card} topics={topics} />}
      drag={{
        kind: "origin",
        brandKey,
        contentLocale: uiLocale,
        origin: {
          kind: "telegram_filter_result",
          telegramFilterResultId: card.telegramFilterResultId,
        },
        title: card.title,
      }}
      route={
        <SendToPlatforms
          cardId={card.telegramFilterResultId}
          contentLocale={uiLocale}
          origin={{
            kind: "telegram_filter_result",
            telegramFilterResultId: card.telegramFilterResultId,
          }}
        />
      }
      title={card.title}
    >
      <ChannelPlate handle={card.channelHandle} />
      <span className="line-clamp-2 text-sm">
        <Bdi>{card.title}</Bdi>
      </span>
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

function SendToPlatforms({
  cardId,
  contentLocale,
  origin,
}: {
  cardId: string;
  contentLocale: ContentLocale;
  origin: CardOriginReference;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { platforms, route } = useRouteContext();

  return (
    <>
      {platforms.map((platform) => {
        const buttonId = `send-${cardId}-${platform}`;

        return (
          <Button
            id={buttonId}
            key={platform}
            onClick={() =>
              route({
                contentLocale,
                origin,
                platform,
                returnFocusId: buttonId,
              })
            }
            size="xs"
            type="button"
            variant="outline"
          >
            {t("platformDraft.sendTo", {
              platform: t(`run.platform.${platform}`),
            })}
          </Button>
        );
      })}
    </>
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
