"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Drawer,
  DrawerClose,
  DrawerDescription,
  DrawerHeader,
  DrawerOverlay,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
  DrawerViewport,
} from "@rz-chain-reporter/ui/components/drawer";
import { XIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { EDITORIAL_NAMESPACE } from "../constants";
import { useNarrowViewport } from "../hooks/use-narrow-viewport";
import {
  type ReportRow,
  type ReportThresholds,
  reportLaneCap,
  reportLowScoreFailures,
} from "../schemas/report";
import type { RunHead } from "../schemas/workspace";
import { ChannelPlate } from "./channel-plate";
import { MutedTag } from "./provenance-line";

const BASIS_POINTS = 10_000;

type Translate = ReturnType<typeof useTranslations<typeof EDITORIAL_NAMESPACE>>;

export function ScoreDrawer({
  children,
  head,
  row,
  thresholds,
}: {
  children: ReactNode;
  head: RunHead;
  row: ReportRow;
  thresholds: ReportThresholds;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const narrow = useNarrowViewport();

  return (
    <Drawer side={narrow ? "block-end" : "inline-end"}>
      <DrawerTrigger
        render={
          <Button
            className="grid h-auto min-h-11 w-full min-w-0 justify-normal gap-1 whitespace-normal px-0 py-1 text-start font-normal"
            variant="ghost"
          />
        }
      >
        {children}
      </DrawerTrigger>
      <DrawerPortal>
        <DrawerOverlay />
        <DrawerViewport>
          <DrawerPopup
            className="w-[min(480px,95vw)] max-compact:h-auto max-compact:max-h-[88dvh] max-compact:w-full max-compact:rounded-t-xl"
            showHandle={false}
          >
            <DrawerClose
              className="absolute top-[calc(--spacing(4)+env(safe-area-inset-top))] max-sm:size-11 ltr:right-[calc(--spacing(4)+env(safe-area-inset-right))] rtl:left-[calc(--spacing(4)+env(safe-area-inset-left))]"
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <XIcon />
              <span className="sr-only">{t("card.close")}</span>
            </DrawerClose>
            <DrawerHeader className="pe-10">
              <DrawerTitle className="text-base/relaxed">
                <Bdi>{row.title}</Bdi>
              </DrawerTitle>
              <DrawerDescription className="sr-only">
                {t("score.description")}
              </DrawerDescription>
            </DrawerHeader>
            <MediaFitBand row={row} t={t} />
            <PolicyBand head={head} row={row} t={t} thresholds={thresholds} />
            <GateBand head={head} row={row} t={t} thresholds={thresholds} />
            {row.sourceOrigin === "telegram_public" ? (
              <TelegramBlock row={row} t={t} />
            ) : null}
            <SemanticBand head={head} row={row} t={t} />
            <DuplicateBand row={row} t={t} thresholds={thresholds} />
            <Footer head={head} row={row} t={t} />
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  );
}

function MediaFitBand({ row, t }: { row: ReportRow; t: Translate }) {
  return (
    <Band title={t("score.band.mediaFit")}>
      {row.mediaFitScore === null || row.mediaFitThreshold === null ? (
        <p>{t("score.notEvaluated")}</p>
      ) : (
        <p className="tabular-nums">
          {t("score.mediaFit.total", {
            score: row.mediaFitScore,
            threshold: row.mediaFitThreshold,
          })}{" "}
          <MutedTag>
            {row.reason === "below_media_fit_threshold"
              ? t("score.gate.failed")
              : t("score.gate.passed")}
          </MutedTag>
        </p>
      )}
      {row.reason === "below_media_fit_threshold" ? (
        <p className="text-muted-foreground">
          {t("score.mediaFit.reason", { reason: t(`reason.${row.reason}`) })}
        </p>
      ) : null}
    </Band>
  );
}

function PolicyBand({
  head,
  row,
  t,
  thresholds,
}: {
  head: RunHead;
  row: ReportRow;
  t: Translate;
  thresholds: ReportThresholds;
}) {
  const topic = topicAt(head, row.lexicalTopicIndex);
  const hasTopics = hasOperatorTopics(head);

  return (
    <Band title={t("score.band.policy")}>
      <p className="ticket-label">{t("score.itemLevel")}</p>
      {topic ? (
        <p>
          <Bdi>{t("score.policy.topicLexical", { topic })}</Bdi>
        </p>
      ) : hasTopics ? (
        <p>{t("score.policy.topicLexicalNoMatch")}</p>
      ) : null}
      {hasTopics ? (
        <p className="tabular-nums">
          {row.lexicalTopicScore === null
            ? t("score.notEvaluated")
            : t("score.policy.topicLexicalScore", {
                threshold: thresholds.lexicalTopicScore,
                value: row.lexicalTopicScore,
              })}
        </p>
      ) : null}
      {row.policyViralityScore === null ? null : (
        <p className="tabular-nums">
          {t("score.policy.virality", { value: row.policyViralityScore })}
        </p>
      )}
      <p className="tabular-nums">
        {row.freshnessScore === null
          ? t("score.policy.freshness.notEvaluated")
          : t("score.policy.freshness.value", { value: row.freshnessScore })}
      </p>
      {row.sourceAuthorityScore === null ? null : (
        <p className="tabular-nums">
          {t("score.policy.authority", { value: row.sourceAuthorityScore })}
        </p>
      )}
      {row.sourcePreferenceScore === null ? null : (
        <p className="tabular-nums">
          {t("score.policy.preference", { value: row.sourcePreferenceScore })}
        </p>
      )}
      {row.diversityScore === null ? null : (
        <p className="tabular-nums">
          {t("score.policy.diversity", { value: row.diversityScore })}
        </p>
      )}
      <p className="tabular-nums">
        {row.policyScore === null
          ? t("score.notEvaluated")
          : t("score.policy.total", {
              threshold: thresholds.policyScore,
              value: row.policyScore,
            })}
      </p>
    </Band>
  );
}

function GateBand({
  head,
  row,
  t,
  thresholds,
}: {
  head: RunHead;
  row: ReportRow;
  t: Translate;
  thresholds: ReportThresholds;
}) {
  const hasTopics = hasOperatorTopics(head);
  const lowScoreFailures = reportLowScoreFailures(row, thresholds, hasTopics);

  return (
    <Band title={t("score.band.gate")}>
      <p className="tabular-nums">{valueGate(row.valueSignalCount, t)}</p>
      <p>
        {`${t("score.gate.mediaFit")} · ${gateVerdict(
          row.mediaFitScore,
          row.reason === "below_media_fit_threshold",
          t,
        )}`}
      </p>
      <p>
        {`${t("score.gate.policy")} · ${gateVerdict(
          row.policyScore,
          lowScoreFailures.includes("policy"),
          t,
        )}`}
      </p>
      {hasTopics ? (
        <p>
          {`${t("score.gate.topicLexical")} · ${gateVerdict(
            row.lexicalTopicScore,
            lowScoreFailures.includes("lexical_topic"),
            t,
          )}`}
        </p>
      ) : null}
      <p>
        <span>{t(`disposition.${row.disposition}`)}</span>
        {row.reason ? ` · ${t(`reason.${row.reason}`)}` : null}
      </p>
      {row.disposition === "cap_exceeded" && row.rankPosition !== null ? (
        <p className="tabular-nums">
          {t("score.capReached", {
            n: reportLaneCap(
              row,
              thresholds,
              head.configuration.kind === "news"
                ? head.configuration.topN
                : thresholds.shortlistCap,
            ),
            r: row.rankPosition,
          })}
        </p>
      ) : null}
    </Band>
  );
}

function TelegramBlock({ row, t }: { row: ReportRow; t: Translate }) {
  const format = useFormatter();

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <p className="flex flex-wrap items-center gap-2">
        <ChannelPlate handle={row.sourceEndpoint} />
        <a
          className="wrap-anywhere underline underline-offset-2"
          href={row.canonicalUrl}
          rel="noreferrer"
          target="_blank"
        >
          <Bdi dir="ltr" translate="no">
            {row.canonicalUrl.replace(/^https?:\/\//, "")}
          </Bdi>
        </a>
      </p>
      {row.publishedAt ? (
        <p>
          {`${t("detail.publishedAt")} · ${format.dateTime(row.publishedAt, {
            dateStyle: "short",
            timeStyle: "short",
          })}`}
        </p>
      ) : null}
      {row.views === null ? null : (
        <p className="tabular-nums">
          {t("telegram.observedViews.value", { n: row.views })}
        </p>
      )}
      {row.orderingMode === null ? null : (
        <p>{t(`run.telegram.ordering.${row.orderingMode}`)}</p>
      )}
      {row.sourceRank === null ? null : (
        <p className="tabular-nums">
          {t("telegram.sourceOrderRank.report", { n: row.sourceRank })}
        </p>
      )}
      {row.rankPosition === null ? null : (
        <p className="tabular-nums">
          {t("telegram.brandRouteRank.report", { n: row.rankPosition })}
        </p>
      )}
    </div>
  );
}

function SemanticBand({
  head,
  row,
  t,
}: {
  head: RunHead;
  row: ReportRow;
  t: Translate;
}) {
  const topic = topicAt(head, row.semanticTopicIndex);
  const { semanticReason, semanticStatus } = head.provenance;

  if (semanticStatus === "degraded") {
    return (
      <Band title={t("score.band.semanticRank")}>
        <p>
          {semanticReason
            ? t("semantic.degraded.reason", {
                reason: t(`semantic.reason.${semanticReason}`),
              })
            : t("semantic.status.degraded")}
        </p>
        <p className="text-muted-foreground">
          {t("semantic.degraded.unavailable")}
        </p>
      </Band>
    );
  }

  if (row.semanticParticipation === "outside_bound") {
    return (
      <Band title={t("score.band.semanticRank")}>
        <p>{t("semantic.outsideBound.detail")}</p>
      </Band>
    );
  }

  return (
    <Band title={t("score.band.semanticRank")}>
      {row.semanticBrandScore === null ? null : (
        <p className="tabular-nums">
          {t("score.semantic.brand", { value: row.semanticBrandScore })}
        </p>
      )}
      {topic && row.semanticTopicScore !== null ? (
        <p className="tabular-nums">
          <Bdi>
            {t("score.semantic.topic", {
              topic,
              value: row.semanticTopicScore,
            })}
          </Bdi>
        </p>
      ) : null}
      {row.semanticBrandScore === null && row.semanticTopicScore === null ? (
        <p>{t("score.notEvaluated")}</p>
      ) : (
        <p className="text-muted-foreground">{t("score.semantic.rankOnly")}</p>
      )}
    </Band>
  );
}

function DuplicateBand({
  row,
  t,
  thresholds,
}: {
  row: ReportRow;
  t: Translate;
  thresholds: ReportThresholds;
}) {
  if (row.duplicateMethod === null) {
    return (
      <Band title={t("score.band.duplicate")}>
        <p>{t("score.notEvaluated")}</p>
      </Band>
    );
  }

  return (
    <Band title={t("score.band.duplicate")}>
      <p>{t(`duplicateMethod.${row.duplicateMethod}`)}</p>
      {row.duplicateOfSourceItemId ? (
        <p className="text-muted-foreground">
          {t("score.duplicate.cluster", {
            id: row.duplicateOfSourceItemId.slice(0, SHORT_ID_LENGTH),
          })}
        </p>
      ) : null}
      {row.duplicateOfTitle && row.duplicateOfOrigin ? (
        <p>
          <Bdi>
            {t("score.duplicate.survivor", {
              kind: t(`origin.${row.duplicateOfOrigin}`),
              title: row.duplicateOfTitle,
            })}
          </Bdi>
        </p>
      ) : null}
      {row.duplicateMethod === "semantic" &&
      row.duplicateSimilarityBp !== null ? (
        <p className="tabular-nums">
          {t("score.duplicate.similarity", {
            threshold: thresholds.semanticDedup,
            value: row.duplicateSimilarityBp / BASIS_POINTS,
          })}
        </p>
      ) : null}
    </Band>
  );
}

function Footer({
  head,
  row,
  t,
}: {
  head: RunHead;
  row: ReportRow;
  t: Translate;
}) {
  return (
    <div className="sticky bottom-0 grid gap-2 border-border bg-popover">
      {head.configuration.kind === "news" ? (
        <p className="text-muted-foreground tabular-nums">
          {t("provenance.topN", { n: head.configuration.topN })}
        </p>
      ) : null}
      <p className="tabular-nums">
        {row.rankScore === null
          ? t("score.notEvaluated")
          : t("score.rankScore.value", { value: row.rankScore })}
      </p>
      {row.rankPosition === null ? null : (
        <p className="tabular-nums">
          {t("score.finalRank", { n: row.rankPosition })}
        </p>
      )}
      <p className="text-muted-foreground">{t("score.rankScore.note")}</p>
    </div>
  );
}

function Band({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="grid gap-2 border-border border-b pb-4">
      <h3 className="ticket-label">{title}</h3>
      {children}
    </section>
  );
}

function valueGate(count: number | null, t: Translate) {
  if (count === null) return t("score.gate.value.notConfigured");

  return count === 0
    ? t("score.gate.value.failed")
    : t("score.gate.value.passed", { n: count });
}

function gateVerdict(value: number | null, failed: boolean, t: Translate) {
  if (value === null) return t("score.notEvaluated");

  return failed ? t("score.gate.failed") : t("score.gate.passed");
}

function topicAt(head: RunHead, index: number | null) {
  if (index === null || head.configuration.kind !== "news") return null;

  return head.configuration.topics[index] ?? null;
}

function hasOperatorTopics(head: RunHead) {
  return (
    head.configuration.kind === "news" && head.configuration.topics.length > 0
  );
}
const SHORT_ID_LENGTH = 8;
