"use client";

import type { Platform } from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@rz-chain-reporter/ui/components/empty";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

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
import {
  PlatformLaneGroup,
  PlatformLanes,
  RouteProvider,
} from "./platform-lane";

const ANNOUNCE_WINDOW_MS = 500;
const SEPARATOR = "\n";
const NO_TOPICS: readonly string[] = [];

type Translate = ReturnType<typeof useTranslations<typeof EDITORIAL_NAMESPACE>>;

export type BoardPresentation = {
  brandKeys: readonly string[];
  kind: "news" | "promo";
  platforms: readonly Platform[];
  telegramOnly: boolean;
};

export function LaneBoardHeader({
  head,
  id,
}: {
  head: RunHead | null;
  id: string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const acquisition = head?.telegramAcquisition;

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-2">
      <h2 className="ticket-label" id={id}>
        {t("lane.board.zone")}
      </h2>
      {acquisition &&
      acquisition.acquiredChannels > 0 &&
      acquisition.acquiredChannels < acquisition.totalChannels ? (
        <p className="ms-auto text-end">
          <Link
            className="text-muted-foreground text-xs underline underline-offset-4"
            href="/sources"
          >
            {t("telegram.acquisition.partial", {
              acquired: acquisition.acquiredChannels,
              total: acquisition.totalChannels,
            })}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export function LaneBoard({
  brands,
  defaultModelOptionKey,
  head,
  limitedGuidanceBrands,
  models,
  modelLanes,
  onOpenCard,
  platformDraftLanes,
  presentation,
  templatePlatforms,
  telegramLanes,
}: {
  brands: RunOptions["brands"];
  defaultModelOptionKey: string;
  head: RunHead | null;
  limitedGuidanceBrands: readonly string[];
  models: RunOptions["models"];
  modelLanes: readonly ModelLane[];
  onOpenCard: (
    card: PlatformDraftLane["drafts"][number],
    trigger: HTMLButtonElement,
  ) => void;
  platformDraftLanes: readonly PlatformDraftLane[];
  presentation: BoardPresentation;
  templatePlatforms: RunOptions["platforms"];
  telegramLanes: readonly TelegramLane[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const board = head
    ? presentationOfHead(head, templatePlatforms)
    : presentation;
  const promo = board.kind === "promo";
  const degraded = head?.provenance.semanticStatus === "degraded";
  const topics =
    head?.configuration.kind === "news" ? head.configuration.topics : NO_TOPICS;
  const slots =
    head && !board.telegramOnly
      ? modelSlots(head, modelLanes, brands, models)
      : [];
  const unitsPlanned =
    head !== null && (modelLanes.length > 0 || head.completedAt !== null);
  const limitedGuidance = new Set(promo ? limitedGuidanceBrands : []);
  const alsoIn = brandsByItem(telegramLanes);
  const selectedBrands = board.brandKeys.flatMap((brandKey) => {
    const brand = brands.find((candidate) => candidate.key === brandKey);
    return brand ? [brand] : [];
  });
  const announcement = useLaneAnnouncements(
    head
      ? [
          head.id,
          ...slots.flatMap((slot) =>
            slotAnnouncements(
              slot,
              promo,
              limitedGuidance.has(slot.brandKey),
              t,
            ),
          ),
          ...telegramAnnouncements(head, telegramLanes, t),
        ].join(SEPARATOR)
      : "fresh",
    t,
  );

  return (
    <>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <RouteProvider
        defaultModelOptionKey={defaultModelOptionKey}
        platforms={board.platforms}
      >
        <PlatformLanes lanes={platformDraftLanes} onOpenCard={onOpenCard}>
          <div className="grid min-w-0 gap-3">
            {head ? <TelegramAcquisitionNotice head={head} /> : null}
            {selectedBrands.length === 0 ? (
              <Empty className="rounded-xl border border-border bg-card p-8">
                <EmptyHeader>
                  <EmptyTitle className="text-sm">
                    {t("lane.board.noBrands")}
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid gap-4">
                {selectedBrands.map((brand) => {
                  const telegramLane = telegramLanes.find(
                    (lane) => lane.brandKey === brand.key,
                  );
                  const brandSlots = slots.filter(
                    (slot) => slot.brandKey === brand.key,
                  );
                  const railCount =
                    (telegramLane ? 1 : 0) +
                    brandSlots.length +
                    board.platforms.length;

                  return (
                    <section
                      aria-labelledby={`brand-rail-${brand.key}`}
                      className="min-w-0 rounded-xl border border-border bg-card/40 p-3"
                      key={brand.key}
                    >
                      <header className="flex items-center gap-2 pb-1">
                        <span
                          aria-hidden="true"
                          className="grid size-7 place-items-center rounded-md bg-accent font-semibold text-accent-foreground text-xs"
                        >
                          {brand.name.slice(0, 1)}
                        </span>
                        <h3
                          className="font-medium"
                          id={`brand-rail-${brand.key}`}
                        >
                          <Bdi>{brand.name}</Bdi>
                        </h3>
                      </header>
                      <section
                        aria-label={t("lane.board.rail", { brand: brand.name })}
                        className="mt-3 flex snap-x snap-proximity gap-3 overflow-x-auto rounded-lg pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable brand rail must be keyboard reachable.
                        tabIndex={0}
                      >
                        {telegramLane ? (
                          <TelegramLaneColumn
                            alsoIn={alsoIn}
                            degraded={Boolean(degraded)}
                            index={0}
                            lane={telegramLane}
                            topics={topics}
                            total={railCount}
                          />
                        ) : null}
                        {head
                          ? brandSlots.map((slot, index) => (
                              <ModelLaneColumn
                                degraded={Boolean(degraded)}
                                index={index + (telegramLane ? 1 : 0)}
                                key={`${slot.modelOptionKey}:${slot.brandKey}`}
                                limitedGuidance={limitedGuidance.has(
                                  slot.brandKey,
                                )}
                                promo={promo}
                                slot={slot}
                                total={railCount}
                                unitsPlanned={unitsPlanned}
                              />
                            ))
                          : null}
                        <PlatformLaneGroup
                          brandKey={brand.key}
                          brandName={brand.name}
                          platforms={board.platforms}
                        />
                      </section>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </PlatformLanes>
      </RouteProvider>
    </>
  );
}

function presentationOfHead(
  head: RunHead,
  templatePlatforms: readonly Platform[],
): BoardPresentation {
  if (head.configuration.kind === "promo") {
    return {
      brandKeys: head.configuration.promo.brands,
      kind: "promo",
      platforms: templatePlatforms,
      telegramOnly: false,
    };
  }

  return {
    brandKeys: head.configuration.brands,
    kind: "news",
    platforms: head.configuration.platforms,
    telegramOnly: head.configuration.telegramOnly,
  };
}

function TelegramAcquisitionNotice({ head }: { head: RunHead }) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { telegramAcquisition } = head;
  const allFailed =
    head.completedAt !== null &&
    telegramAcquisition.totalChannels > 0 &&
    telegramAcquisition.acquiredChannels === 0 &&
    telegramAcquisition.failures.length === telegramAcquisition.totalChannels;

  if (allFailed) {
    return (
      <Empty className="w-full border border-border p-4">
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
    );
  }

  return null;
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
