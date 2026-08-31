"use client";

import { useDraggable } from "@dnd-kit/react";
import type {
  CardOriginReference,
  ContentLocale,
} from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Card } from "@rz-chain-reporter/ui/components/card";
import { Hint } from "@rz-chain-reporter/ui/components/hint";
import { Sheet, SheetTrigger } from "@rz-chain-reporter/ui/components/sheet";
import { GripVerticalIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { EDITORIAL_NAMESPACE } from "../constants";
import type { PlatformDraftCard } from "../schemas/drafts";
import type {
  PresentationTranslationStatus,
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
import {
  type OriginDragData,
  originUiKey,
  useRouteContext,
} from "./platform-lane";
import {
  PlatformRouteButton,
  PlatformRouteStatus,
} from "./platform-route-control";
import { PresentationTranslationButton } from "./presentation-translation-button";
import { FallbackTag, MutedTag, ProvenanceLine } from "./provenance-line";

type Translate = ReturnType<typeof useTranslations<typeof EDITORIAL_NAMESPACE>>;

const CARD_CLASS =
  "gap-2 rounded-lg border border-border bg-card p-3 ring-0 transition-colors hover:border-ring/40 data-[dragging]:opacity-70 data-[dragging]:shadow-lg data-[dragging]:ring-2 data-[dragging]:ring-ring motion-reduce:transition-none";

function LaneCard({
  children,
  details,
  drag,
  presentationReady,
  presentationTranslation,
  route,
  title,
}: {
  children: ReactNode;
  details: ReactNode;
  drag: OriginDragData;
  presentationReady: boolean;
  presentationTranslation: PresentationTranslationStatus | null;
  route: ReactNode;
  title: string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const id = originUiKey(drag.brandKey, drag.origin);
  const dragLabel = t("platformDraft.dragOrigin", { title: drag.title });
  const { handleRef, isDragging, ref } = useDraggable<OriginDragData>({
    data: drag,
    id: `origin-${id}`,
    type: "origin",
  });

  return (
    <Card
      className={CARD_CLASS}
      data-dragging={isDragging || undefined}
      ref={ref}
      role="article"
    >
      <Sheet>
        <SheetTrigger
          render={
            <Button
              className="grid h-auto min-h-11 w-full min-w-0 justify-normal gap-2 whitespace-normal p-1 text-start font-normal sm:min-h-0"
              type="button"
              variant="ghost"
            />
          }
        >
          {children}
        </SheetTrigger>
        <CardDetailsSheet title={title}>{details}</CardDetailsSheet>
      </Sheet>
      <CardActionRow
        controls={
          <>
            <Hint label={t("platformDraft.hint.dragOrigin")}>
              <Button
                aria-label={dragLabel}
                className="max-compact:size-11"
                id={`origin-handle-${id}`}
                ref={handleRef}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <GripVerticalIcon aria-hidden="true" />
              </Button>
            </Hint>
            <PresentationTranslationButton
              origin={drag.origin}
              presentationReady={presentationReady}
              translation={presentationTranslation}
              title={drag.title}
            />
          </>
        }
        routes={route}
      />
    </Card>
  );
}

export function PlatformDraftLaneCard({
  card,
  controls,
  onOpen,
  siblingRoutes,
}: {
  card: PlatformDraftCard;
  controls: ReactNode;
  onOpen: (trigger: HTMLButtonElement) => void;
  siblingRoutes: ReactNode;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const completed =
    card.generation?.units.filter((unit) => unit.status === "succeeded")
      .length ?? 0;
  const total = card.generation?.units.length ?? 0;

  return (
    <Card
      className="gap-2 rounded-lg border border-border p-3 ring-0 transition-colors hover:border-ring/40 motion-reduce:transition-none"
      role="article"
    >
      <div className="flex min-w-0 items-start gap-2">
        <Button
          className="grid h-auto min-h-11 w-full min-w-0 justify-normal gap-2 whitespace-normal p-1 text-start"
          onClick={(event) => onOpen(event.currentTarget)}
          type="button"
          variant="ghost"
        >
          <span className="line-clamp-2 font-medium text-sm/relaxed">
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
        </Button>
      </div>
      <CardActionRow controls={controls} routes={siblingRoutes} />
    </Card>
  );
}

function CardActionRow({
  controls,
  routes,
}: {
  controls: ReactNode;
  routes: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-1.5 border-border/60 border-t pt-2">
      <div className="flex items-center gap-1">{controls}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-1">{routes}</div>
    </div>
  );
}

export function PendingPlatformRouteCard({ title }: { title: string }) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <Card
      aria-busy="true"
      className="mx-2 mb-2 gap-1.5 rounded-lg border-dashed bg-card/70 p-3 shadow-none"
      role="article"
    >
      <span className="line-clamp-2 font-medium text-sm/relaxed">
        <Bdi>{title}</Bdi>
      </span>
      <span className="text-muted-foreground text-xs">
        {t("platformDraft.routing")}
      </span>
    </Card>
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
      presentationReady={card.presentationReady}
      presentationTranslation={card.presentationTranslation}
      route={
        <SendToPlatforms
          brandKey={brandKey}
          cardId={card.id}
          contentLocale={uiLocale}
          origin={{
            kind: "editorial_selection",
            editorialSelectionId: card.id,
          }}
          title={card.title}
        />
      }
      title={card.title}
    >
      <span className="line-clamp-2 font-medium text-sm/relaxed">
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
}: {
  brandKey: string;
  brandName: string;
  card: PromoIdeaCard;
  fallback: boolean;
  limitedGuidance: boolean;
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
      presentationReady={card.presentationReady}
      presentationTranslation={card.presentationTranslation}
      title={card.title}
      route={
        <SendToPlatforms
          brandKey={brandKey}
          cardId={card.id}
          contentLocale={uiLocale}
          origin={{ kind: "promo_idea", promoIdeaId: card.id }}
          title={card.title}
        />
      }
    >
      <span className="line-clamp-2 font-medium text-sm/relaxed">
        <Bdi>{card.title}</Bdi>
      </span>
      <span className="line-clamp-2 text-muted-foreground text-xs">
        <Bdi>{card.description}</Bdi>
      </span>
      {fallback ? (
        <ProvenanceLine segments={[]}>
          <FallbackTag
            detail={t("lane.fallback.detail")}
            tag={t("lane.fallback.tag")}
          />
        </ProvenanceLine>
      ) : null}
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
      presentationReady={card.presentationReady}
      presentationTranslation={card.presentationTranslation}
      route={
        <SendToPlatforms
          brandKey={brandKey}
          cardId={card.telegramFilterResultId}
          contentLocale={uiLocale}
          origin={{
            kind: "telegram_filter_result",
            telegramFilterResultId: card.telegramFilterResultId,
          }}
          title={card.title}
        />
      }
      title={card.title}
    >
      <ChannelPlate handle={card.channelHandle} />
      <span className="line-clamp-2 font-medium text-sm/relaxed">
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
  brandKey,
  cardId,
  contentLocale,
  origin,
  title,
}: {
  brandKey: string;
  cardId: string;
  contentLocale: ContentLocale;
  origin: CardOriginReference;
  title: string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { isRoutePending, isRouted, platforms, route } = useRouteContext();

  return (
    <>
      {platforms.map((platform) => {
        const buttonId = `send-${cardId}-${platform}`;
        const pending = isRoutePending(brandKey, origin, platform);
        const routed = isRouted(brandKey, origin, platform);

        if (routed) {
          const platformName = t(`run.platform.${platform}`);

          return (
            <PlatformRouteStatus
              accessibleLabel={t("platformDraft.alreadyRouted", {
                platform: platformName,
              })}
              key={platform}
              platform={platform}
            />
          );
        }

        const platformName = t(`run.platform.${platform}`);

        return (
          <PlatformRouteButton
            accessibleLabel={
              pending
                ? t("platformDraft.a11y.routing", {
                    platform: platformName,
                    title,
                  })
                : t("platformDraft.sendTo", { platform: platformName })
            }
            buttonId={buttonId}
            hint={
              pending
                ? t("platformDraft.routingTo", { platform: platformName })
                : t("platformDraft.sendTo", { platform: platformName })
            }
            key={platform}
            onClick={() =>
              route({
                brandKey,
                contentLocale,
                origin,
                platform,
                returnFocusId: buttonId,
                title,
              })
            }
            pending={pending}
            platform={platform}
          />
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
