"use client";

import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@rz-chain-reporter/ui/components/empty";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Link } from "@/i18n/navigation";

import { EDITORIAL_NAMESPACE } from "../constants";
import type { PlatformDraftLane } from "../schemas/drafts";
import type {
  ModelLane,
  RunHead,
  RunOptions,
  TelegramLane,
} from "../schemas/workspace";
import { ChannelPlate } from "./channel-plate";
import {
  ModelLaneColumn,
  type ModelSlot,
  TelegramLaneColumn,
} from "./lane-column";
import { PlatformLanes, RouteProvider } from "./platform-lane";

const ANNOUNCE_WINDOW_MS = 500;
const SEPARATOR = "\n";
const NO_TOPICS: readonly string[] = [];

type Translate = ReturnType<typeof useTranslations<typeof EDITORIAL_NAMESPACE>>;

export function LaneBoard({
  brands,
  defaultModelOptionKey,
  head,
  limitedGuidanceBrands,
  models,
  modelLanes,
  platformDraftLanes,
  templatePlatforms,
  telegramLanes,
}: {
  brands: RunOptions["brands"];
  defaultModelOptionKey: string;
  head: RunHead;
  limitedGuidanceBrands: readonly string[];
  models: RunOptions["models"];
  modelLanes: readonly ModelLane[];
  platformDraftLanes: readonly PlatformDraftLane[];
  templatePlatforms: RunOptions["platforms"];
  telegramLanes: readonly TelegramLane[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const promo = head.kind === "promo";
  const routePlatforms =
    head.configuration.kind === "news"
      ? head.configuration.platforms
      : templatePlatforms;
  const telegramOnly =
    head.configuration.kind === "news" && head.configuration.telegramOnly;
  const degraded = head.provenance.semanticStatus === "degraded";
  const topics =
    head.configuration.kind === "news" ? head.configuration.topics : NO_TOPICS;
  const slots = telegramOnly
    ? []
    : modelSlots(head, modelLanes, brands, models);
  const unitsPlanned = modelLanes.length > 0 || head.completedAt !== null;
  const limitedGuidance = new Set(promo ? limitedGuidanceBrands : []);
  const alsoIn = brandsByItem(telegramLanes);
  const { telegramAcquisition } = head;
  const partialTelegramAcquisition =
    telegramAcquisition.acquiredChannels > 0 &&
    telegramAcquisition.acquiredChannels < telegramAcquisition.totalChannels;
  const allTelegramSourcesFailed =
    head.completedAt !== null &&
    telegramAcquisition.totalChannels > 0 &&
    telegramAcquisition.acquiredChannels === 0 &&
    telegramAcquisition.failures.length === telegramAcquisition.totalChannels;
  const telegramZoneVisible =
    !promo &&
    (telegramLanes.length > 0 || telegramAcquisition.totalChannels > 0);
  const announcement = useLaneAnnouncements(
    [
      head.id,
      ...slots.flatMap((slot) =>
        slotAnnouncements(slot, promo, limitedGuidance.has(slot.brandKey), t),
      ),
      ...telegramAnnouncements(head, telegramLanes, t),
    ].join(SEPARATOR),
    t,
  );

  return (
    <>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <RouteProvider
        defaultModelOptionKey={defaultModelOptionKey}
        platforms={routePlatforms}
      >
        <div className="mt-8 border-border border-t border-dashed pt-4">
          <h2 className="ticket-label">{t("lane.board.zone")}</h2>
          <PlatformLanes lanes={platformDraftLanes}>
            {telegramOnly ? null : (
              <>
                <h3 className="ticket-label mt-3 text-muted-foreground">
                  {t("lane.model.zone")}
                </h3>
                <section
                  aria-label={t("lane.model.zone")}
                  className="mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable lane region must be reachable without a pointer.
                  tabIndex={0}
                >
                  {slots.map((slot, index) => (
                    <ModelLaneColumn
                      degraded={degraded}
                      index={index}
                      key={`${slot.modelOptionKey}:${slot.brandKey}`}
                      limitedGuidance={limitedGuidance.has(slot.brandKey)}
                      promo={promo}
                      runId={head.id}
                      slot={slot}
                      total={slots.length}
                      unitsPlanned={unitsPlanned}
                    />
                  ))}
                </section>
              </>
            )}
            {telegramZoneVisible ? (
              <LaneSubsection
                label={t("lane.telegram.zone")}
                status={
                  partialTelegramAcquisition ? (
                    <Link
                      className="font-mono text-muted-foreground text-xs underline underline-offset-4"
                      href="/sources"
                    >
                      {t("telegram.acquisition.partial", {
                        acquired: telegramAcquisition.acquiredChannels,
                        total: telegramAcquisition.totalChannels,
                      })}
                    </Link>
                  ) : null
                }
              >
                {telegramLanes.length > 0 ? (
                  telegramLanes.map((lane, index) => (
                    <TelegramLaneColumn
                      alsoIn={alsoIn}
                      degraded={degraded}
                      index={index}
                      key={lane.mediaBrandId}
                      lane={lane}
                      topics={topics}
                      total={telegramLanes.length}
                    />
                  ))
                ) : allTelegramSourcesFailed ? (
                  <Empty className="w-full p-4">
                    <EmptyHeader>
                      <EmptyTitle className="text-sm">
                        {t("telegram.acquisition.failed")}
                      </EmptyTitle>
                    </EmptyHeader>
                    <EmptyContent className="items-start">
                      <ul className="grid gap-2 text-sm">
                        {telegramAcquisition.failures.map((failure) => (
                          <li
                            className="flex flex-wrap items-center gap-2"
                            key={`${failure.channelHandle}:${failure.code}`}
                          >
                            <ChannelPlate handle={failure.channelHandle} />
                            <code
                              className="text-muted-foreground"
                              dir="ltr"
                              translate="no"
                            >
                              {failure.code}
                            </code>
                          </li>
                        ))}
                      </ul>
                      <Link
                        className="text-sm underline underline-offset-4"
                        href="/sources"
                      >
                        {t("telegram.acquisition.openSources")}
                      </Link>
                    </EmptyContent>
                  </Empty>
                ) : head.completedAt !== null ? (
                  <Empty className="w-full p-4">
                    <EmptyHeader>
                      <EmptyTitle className="text-sm">
                        {t("telegram.none")}
                      </EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                ) : null}
              </LaneSubsection>
            ) : null}
            <h3 className="ticket-label mt-6 border-border border-t border-dashed pt-4 text-muted-foreground">
              {t("platformDraft.zone")}
            </h3>
          </PlatformLanes>
        </div>
      </RouteProvider>
      <p className="mt-6 text-end">
        <Link
          className="text-sm underline underline-offset-4"
          href={`/dashboard/runs/${head.id}/report`}
        >
          {t("report.link")}
        </Link>
      </p>
    </>
  );
}

function LaneSubsection({
  children,
  label,
  status,
}: {
  children: ReactNode;
  label: string;
  status?: ReactNode;
}) {
  return (
    <div className="mt-6 border-border border-t border-dashed pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="ticket-label text-muted-foreground">{label}</h3>
        {status}
      </div>
      <section
        aria-label={label}
        className="mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable lane region must be reachable without a pointer.
        tabIndex={0}
      >
        {children}
      </section>
    </div>
  );
}

function modelSlots(
  head: RunHead,
  modelLanes: readonly ModelLane[],
  brands: RunOptions["brands"],
  models: RunOptions["models"],
): ModelSlot[] {
  const { configuration } = head;
  const brandKeys =
    configuration.kind === "promo"
      ? configuration.promo.brands
      : configuration.brands;
  const brandNames = new Map(brands.map((brand) => [brand.key, brand.name]));
  const modelNames = new Map(models.map((model) => [model.key, model.name]));
  const laneByPair = new Map(
    modelLanes.map((lane) => [`${lane.modelOptionKey}:${lane.brandKey}`, lane]),
  );

  return configuration.models.flatMap((modelOptionKey) =>
    brandKeys.map((brandKey) => ({
      brandKey,
      brandName: brandNames.get(brandKey) ?? brandKey,
      lane: laneByPair.get(`${modelOptionKey}:${brandKey}`) ?? null,
      modelName: modelNames.get(modelOptionKey) ?? modelOptionKey,
      modelOptionKey,
    })),
  );
}

function brandsByItem(lanes: readonly TelegramLane[]) {
  const byItem = new Map<string, string[]>();

  for (const lane of lanes) {
    for (const card of lane.cards) {
      const brands = byItem.get(card.sourceItemId);
      if (brands) {
        brands.push(lane.brandName);
      } else {
        byItem.set(card.sourceItemId, [lane.brandName]);
      }
    }
  }

  return byItem;
}

function slotAnnouncements(
  slot: ModelSlot,
  promo: boolean,
  limitedGuidance: boolean,
  t: Translate,
) {
  const messages = limitedGuidance
    ? [t("lane.limitedGuidance.announce", { brand: slot.brandName })]
    : [];
  const { lane } = slot;

  if (lane === null) {
    return messages;
  }

  const values = { brand: slot.brandName, model: slot.modelName };
  const cards = promo ? lane.promoIdeas.length : lane.selections.length;

  if (lane.status === "failed") {
    messages.push(t("lane.announce.failed", values));
  } else if (lane.status === "succeeded") {
    messages.push(
      cards === 0
        ? t("lane.announce.arrivedNone", values)
        : t("lane.announce.arrived", { ...values, n: cards }),
    );
  }

  return messages;
}

function telegramAnnouncements(
  head: RunHead,
  lanes: readonly TelegramLane[],
  t: Translate,
) {
  if (head.kind === "promo") {
    return [];
  }
  const { telegramAcquisition } = head;
  const partial =
    telegramAcquisition.acquiredChannels > 0 &&
    telegramAcquisition.acquiredChannels < telegramAcquisition.totalChannels;
  const allFailed =
    head.completedAt !== null &&
    telegramAcquisition.totalChannels > 0 &&
    telegramAcquisition.acquiredChannels === 0 &&
    telegramAcquisition.failures.length === telegramAcquisition.totalChannels;

  if (allFailed) {
    return [t("telegram.acquisition.failedAnnouncement")];
  }

  const messages = partial
    ? [
        t("telegram.acquisition.partialAnnouncement", {
          acquired: telegramAcquisition.acquiredChannels,
          total: telegramAcquisition.totalChannels,
        }),
      ]
    : [];

  if (lanes.length === 0) {
    return head.completedAt === null
      ? messages
      : [...messages, t("telegram.none")];
  }

  return [
    ...messages,
    ...lanes.map((lane) =>
      t("telegram.arrived", { brand: lane.brandName, n: lane.cards.length }),
    ),
  ];
}

// Coalesce bursts into one polite announcement; changing runs resets the
// baseline so existing lanes are not re-announced.
function useLaneAnnouncements(signature: string, t: Translate) {
  const previousRef = useRef<string | null>(null);
  const pendingRef = useRef<string[]>([]);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = signature;

    const [runId, ...messages] = signature.split(SEPARATOR);
    if (previous === null || !previous.startsWith(`${runId}${SEPARATOR}`)) {
      pendingRef.current = [];
      setAnnouncement("");
    } else {
      const spoken = new Set(previous.split(SEPARATOR).slice(1));
      pendingRef.current.push(
        ...messages.filter((message) => !spoken.has(message)),
      );
    }

    if (pendingRef.current.length === 0) {
      return;
    }

    const timer = setTimeout(() => {
      const queued = pendingRef.current;
      const [first] = queued;
      pendingRef.current = [];
      setAnnouncement(
        queued.length === 1 && first
          ? first
          : t("a11y.lanesUpdated", { n: queued.length }),
      );
    }, ANNOUNCE_WINDOW_MS);

    return () => clearTimeout(timer);
  }, [signature, t]);

  return announcement;
}
