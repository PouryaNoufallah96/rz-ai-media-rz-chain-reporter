"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import {
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@rz-chain-reporter/ui/components/sheet";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { EDITORIAL_NAMESPACE } from "../constants";
import { useNarrowViewport } from "../hooks/use-narrow-viewport";
import type {
  PromoIdeaCard,
  SelectionCard,
  TelegramCard,
} from "../schemas/workspace";
import { ChannelPlate } from "./channel-plate";
import { ExpandablePreview } from "./expandable-preview";

export function CardDetailsSheet({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const narrow = useNarrowViewport();

  return (
    <SheetContent
      className="w-full gap-5 max-compact:rounded-t-xl sm:w-[min(720px,100vw)] sm:[--sheet-padding:--spacing(5)]"
      closeLabel={t("card.close")}
      side={narrow ? "block-end" : "inline-end"}
    >
      <SheetHeader className="border-border border-b pe-12 pb-4">
        <SheetTitle className="text-base/relaxed">
          <Bdi>{title}</Bdi>
        </SheetTitle>
        <SheetDescription className="sr-only">
          {t("card.description")}
        </SheetDescription>
      </SheetHeader>
      <dl className="@container grid gap-3 text-xs">{children}</dl>
    </SheetContent>
  );
}

function CardDetail({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="grid @sm:grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-1">
      <dt className="wrap-anywhere text-muted-foreground">{label}</dt>
      <dd className="wrap-anywhere min-w-0">{children}</dd>
    </div>
  );
}

export function SelectionDetails({ card }: { card: SelectionCard }) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <>
      <CardDetail label={t("detail.source")}>
        <Bdi>{card.sourceName}</Bdi>
      </CardDetail>
      <CardDetail label={t("detail.link")}>
        <ExternalLink href={card.canonicalUrl} />
      </CardDetail>
      {card.publishedAt ? (
        <CardDetail label={t("detail.publishedAt")}>
          {format.dateTime(card.publishedAt, {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </CardDetail>
      ) : null}
      <CardDetail label={t("detail.contentLocale")}>
        <span className="font-mono">{card.contentLocale}</span>
      </CardDetail>
      <CardDetail label={t("detail.platform")}>
        {t(`run.platform.${card.suggestedPlatform}`)}
      </CardDetail>
      {card.summary ? (
        <CardDetail label={t("detail.summary")}>
          <ExpandablePreview>{card.summary}</ExpandablePreview>
        </CardDetail>
      ) : null}
      <div className="ticket-label mt-2">{t("selection.modelOutput")}</div>
      {card.reasoning ? (
        <CardDetail label={t("detail.reasoning")}>
          <Prose>{card.reasoning}</Prose>
        </CardDetail>
      ) : null}
      <Score label={t("selection.suitability")} value={card.suitabilityScore} />
      <Score label={t("selection.impact")} value={card.impactScore} />
      <Score label={t("selection.virality")} value={card.viralityScore} />
      <Score label={t("selection.confidence")} value={card.confidenceScore} />
    </>
  );
}

export function PromoDetails({
  brandName,
  card,
  limitedGuidance,
}: {
  brandName: string;
  card: PromoIdeaCard;
  limitedGuidance: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <>
      <CardDetail label={t("promo.description")}>
        <Prose>{card.description}</Prose>
      </CardDetail>
      <CardDetail label={t("promo.angle")}>
        <Prose>{card.angle}</Prose>
      </CardDetail>
      {limitedGuidance ? (
        <div className="text-muted-foreground">
          {t("lane.limitedGuidance.detail", { brand: brandName })}
        </div>
      ) : null}
    </>
  );
}

export function TelegramDetails({
  alsoIn,
  card,
  topics,
}: {
  alsoIn: readonly string[];
  card: TelegramCard;
  topics: readonly string[];
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <>
      <CardDetail label={t("telegram.channel")}>
        <ChannelPlate handle={card.channelHandle} />
      </CardDetail>
      <CardDetail label={t("telegram.messageLink")}>
        <ExternalLink href={card.canonicalUrl} />
      </CardDetail>
      {card.publishedAt ? (
        <CardDetail label={t("detail.publishedAt")}>
          {format.dateTime(card.publishedAt, {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </CardDetail>
      ) : null}
      {card.views === null ? null : (
        <CardDetail label={t("telegram.observedViews.label")}>
          <span className="tabular-nums">{format.number(card.views)}</span>
        </CardDetail>
      )}
      <CardDetail label={t("telegram.ordering.label")}>
        {t(`run.telegram.ordering.${card.orderingMode}`)}
      </CardDetail>
      {card.sourceRank === null ? null : (
        <CardDetail label={t("telegram.sourceOrderRank.label")}>
          {perSourceOrdering(card.orderingMode)
            ? t("telegram.sourceOrderRank.perSource", {
                channel: `@${card.channelHandle}`,
                n: card.sourceRank,
              })
            : t("telegram.sourceOrderRank.global", { n: card.sourceRank })}
        </CardDetail>
      )}
      {card.rankPosition === null ? null : (
        <CardDetail label={t("telegram.brandRouteRank.label")}>
          {t("telegram.brandRouteRank.value", { n: card.rankPosition })}
        </CardDetail>
      )}
      <CardDetail label={t("detail.disposition")}>
        {t(`disposition.${card.disposition}`)}
      </CardDetail>
      {card.reason ? (
        <CardDetail label={t("detail.reason")}>
          {t(`reason.${card.reason}`)}
        </CardDetail>
      ) : null}
      {card.orderingMode === "keywords" && topics.length > 0 ? (
        <CardDetail label={t("telegram.topics")}>
          <Bdi>{format.list(topics)}</Bdi>
        </CardDetail>
      ) : null}
      {card.semanticParticipation === "outside_bound" ? (
        <div className="text-muted-foreground">
          {t("semantic.outsideBound.detail")}
        </div>
      ) : null}
      {card.duplicateMethod ? (
        <CardDetail label={t("detail.duplicate")}>
          {t(`duplicateMethod.${card.duplicateMethod}`)}
          {card.duplicateMethod === "semantic" &&
          card.duplicateSimilarityBp !== null
            ? ` · ${t("telegram.similarity", { value: card.duplicateSimilarityBp / BASIS_POINTS })}`
            : null}
        </CardDetail>
      ) : null}
      {alsoIn.length > 0 ? (
        <CardDetail label={t("telegram.alsoIn.label")}>
          <Bdi>{format.list(alsoIn)}</Bdi>
        </CardDetail>
      ) : null}
      <CardDetail label={t("detail.contentLocale")}>
        <span className="font-mono">{card.contentLocale}</span>
      </CardDetail>
      {card.summary ? (
        <CardDetail label={t("detail.summary")}>
          <ExpandablePreview>{card.summary}</ExpandablePreview>
        </CardDetail>
      ) : null}
    </>
  );
}

const BASIS_POINTS = 10_000;

export function perSourceOrdering(mode: TelegramCard["orderingMode"]) {
  return mode === "views_per_source" || mode === "latest_per_source";
}

function Score({ label, value }: { label: string; value: number | null }) {
  const format = useFormatter();

  return value === null ? null : (
    <CardDetail label={label}>
      <span className="tabular-nums">{format.number(value)}</span>
    </CardDetail>
  );
}

function ExternalLink({ href }: { href: string }) {
  return (
    <a
      className="wrap-anywhere font-mono underline underline-offset-2"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <Bdi dir="ltr">{href.replace(/^https?:\/\//, "")}</Bdi>
    </a>
  );
}

function Prose({ children }: { children: string }) {
  return (
    <Bdi className="block text-start" dir="auto">
      {children}
    </Bdi>
  );
}
