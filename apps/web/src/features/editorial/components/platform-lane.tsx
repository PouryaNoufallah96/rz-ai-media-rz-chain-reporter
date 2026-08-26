"use client";

import {
  Accessibility,
  type DragDropManagerInput,
  PointerActivationConstraints,
} from "@dnd-kit/dom";
import {
  DragDropProvider,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
} from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import {
  type CardOriginReference,
  type ContentLocale,
  cardOriginReferenceSchema,
  contentLocaleSchema,
  type Platform,
  platformSchema,
} from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { GripVerticalIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  startTransition,
  useContext,
  useEffect,
  useOptimistic,
  useRef,
  useState,
} from "react";

import { useAction } from "@/hooks/use-action";

import { reorderPlatformDraftsAction } from "../actions/reorder-platform-drafts";
import { routePlatformDraftAction } from "../actions/route-platform-draft";
import { EDITORIAL_NAMESPACE } from "../constants";
import type {
  PlatformDraftCard,
  PlatformDraftLane as PlatformDraftLaneValue,
} from "../schemas/drafts";
import { PlatformDraftLaneCard } from "./lane-card";
import { SHORT_ID_LENGTH } from "./run-selector";

type DraftDragData = {
  kind: "draft";
  cardId: string;
  laneKey: string;
  mediaBrandId: string;
  origin: CardOriginReference;
  platform: Platform;
  title: string;
};

type LaneDragData = {
  kind: "lane";
  laneKey: string;
  mediaBrandId: string;
  platform: Platform;
};

export type OriginDragData = {
  kind: "origin";
  brandKey: string;
  contentLocale: ContentLocale;
  origin: CardOriginReference;
  title: string;
};

type DragData = DraftDragData | LaneDragData;

type RouteRequest = {
  contentLocale: ContentLocale;
  origin: CardOriginReference;
  platform: Platform;
  returnFocusId: string;
};

type RouteContextValue = {
  announce: (message: string) => void;
  platforms: readonly Platform[];
  route: (request: RouteRequest) => void;
};

type PluginConfigurator = Extract<
  NonNullable<DragDropManagerInput["plugins"]>,
  (...args: never[]) => unknown
>;

type AccessibilityAnnouncements = NonNullable<
  NonNullable<ConstructorParameters<typeof Accessibility>[1]>["announcements"]
>;

type ReorderPrediction = {
  cardId: string;
  destinationIndex: number;
  laneKey: string;
};

const RouteContext = createContext<RouteContextValue | null>(null);

const pointerSensor = PointerSensor.configure({
  activationConstraints: [
    new PointerActivationConstraints.Distance({ value: 8 }),
  ],
});

export function useRouteContext() {
  const value = useContext(RouteContext);
  if (!value) throw new Error("Editorial routing requires RouteProvider");
  return value;
}

export function RouteProvider({
  children,
  defaultModelOptionKey,
  platforms,
}: {
  children: ReactNode;
  defaultModelOptionKey: string;
  platforms: readonly Platform[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [announcement, setAnnouncement] = useState("");
  const action = useAction(routePlatformDraftAction);
  const { isPending } = action;

  const route = ({
    contentLocale,
    origin,
    platform,
    returnFocusId,
  }: RouteRequest) => {
    if (isPending) return;
    void (async () => {
      const settled = await action.execute({
        origin,
        platform,
        modelOptionKey: defaultModelOptionKey,
        requestedContentLocale: contentLocale,
        idempotencyKey: crypto.randomUUID(),
      });
      setAnnouncement(
        settled.data
          ? t(
              settled.data.status === "reconciled"
                ? "route.existing"
                : "route.queued",
              { id: settled.data.draftId.slice(0, SHORT_ID_LENGTH) },
            )
          : routeError(t, settled.code),
      );
      requestAnimationFrame(() =>
        document.getElementById(returnFocusId)?.focus(),
      );
    })();
  };

  return (
    <RouteContext value={{ announce: setAnnouncement, platforms, route }}>
      <p aria-atomic="true" className="sr-only" role="status">
        {announcement}
      </p>
      {children}
    </RouteContext>
  );
}

function predictReorder(
  lanes: readonly PlatformDraftLaneValue[],
  { cardId, destinationIndex, laneKey }: ReorderPrediction,
) {
  const laneIndex = lanes.findIndex((lane) => keyOf(lane) === laneKey);
  const lane = lanes[laneIndex];
  if (!lane) return lanes;
  const sourceIndex = lane.drafts.findIndex((draft) => draft.id === cardId);
  if (sourceIndex < 0 || sourceIndex === destinationIndex) return lanes;

  const ordered = [...lane.drafts];
  const [moved] = ordered.splice(sourceIndex, 1);
  if (!moved) return lanes;
  ordered.splice(destinationIndex, 0, moved);

  return lanes.map((value, index) =>
    index === laneIndex
      ? {
          ...value,
          drafts: ordered.map((draft, position) => ({
            ...draft,
            lanePosition: position + 1,
          })),
        }
      : value,
  );
}

export function PlatformLanes({
  children,
  lanes: initialLanes,
}: {
  children: ReactNode;
  lanes: readonly PlatformDraftLaneValue[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const uiLocale = useLocale();
  const { announce, platforms, route } = useRouteContext();
  const [lanes, applyReorder] = useOptimistic(initialLanes, predictReorder);
  const action = useAction(reorderPlatformDraftsAction);
  const translatorRef = useRef(t);
  useEffect(() => {
    translatorRef.current = t;
  }, [t]);
  const [configurePlugins] = useState<PluginConfigurator>(() => {
    const accessibilityAnnouncements: AccessibilityAnnouncements = {
      dragstart: ({ operation }) =>
        translatorRef.current("platformDraft.a11y.pickedUp", {
          title:
            draftData(operation.source?.data)?.title ??
            originData(operation.source?.data)?.title ??
            "",
        }),
      dragend: ({ operation }) =>
        operation.canceled
          ? translatorRef.current("platformDraft.a11y.cancelled")
          : translatorRef.current("platformDraft.a11y.dropped"),
    };

    const configureAccessibility: PluginConfigurator = (defaults) =>
      defaults.map((plugin) =>
        plugin === Accessibility
          ? Accessibility.configure({
              announcements: accessibilityAnnouncements,
              screenReaderInstructions: {
                draggable: translatorRef.current(
                  "platformDraft.a11y.instructions",
                ),
              },
            })
          : plugin,
      );

    return configureAccessibility;
  });

  const reorder = (
    laneKey: string,
    cardId: string,
    destinationIndex: number,
  ) => {
    const laneIndex = lanes.findIndex((lane) => keyOf(lane) === laneKey);
    const lane = lanes[laneIndex];
    if (!lane) return;
    const sourceIndex = lane.drafts.findIndex((draft) => draft.id === cardId);
    if (sourceIndex < 0 || sourceIndex === destinationIndex) return;

    const ordered = [...lane.drafts];
    const [moved] = ordered.splice(sourceIndex, 1);
    if (!moved) return;
    ordered.splice(destinationIndex, 0, moved);
    announce(
      t("platformDraft.a11y.moved", {
        position: destinationIndex + 1,
        title: moved.originTitle,
      }),
    );

    startTransition(async () => {
      applyReorder({ cardId, destinationIndex, laneKey });
      const settled = await action.execute({
        platformDraftId: moved.id,
        expectedVersion: moved.version,
        orderedDraftIds: ordered.map((draft) => draft.id),
      });
      if (settled.status === "error" || !settled.data) {
        announce(t("platformDraft.a11y.conflict"));
      }
      requestAnimationFrame(() =>
        document.getElementById(`draft-handle-${moved.id}`)?.focus(),
      );
    });
  };

  const sendTo = (
    card: PlatformDraftCard,
    platform: Platform,
    returnFocusId: string,
  ) => {
    if (platform === card.platform || !platforms.includes(platform)) {
      return;
    }

    const destination = lanes.find(
      (lane) =>
        lane.mediaBrandId === card.mediaBrandId && lane.platform === platform,
    );
    if (!destination) {
      return;
    }
    if (hasOrigin(destination, card.origin)) {
      announce(
        t("platformDraft.a11y.alreadyRouted", {
          platform: t(`run.platform.${platform}`),
        }),
      );
      return;
    }

    route({
      contentLocale: card.generation?.requestedContentLocale ?? uiLocale,
      origin: card.origin,
      platform,
      returnFocusId,
    });
  };

  const onDragEnd = ({ operation }: DragEndEvent) => {
    const target = dragData(operation.target?.data);
    const dropped = originData(operation.source?.data);
    if (dropped && target) {
      const destination = lanes.find((lane) => keyOf(lane) === target.laneKey);
      if (
        !destination ||
        destination.brandKey !== dropped.brandKey ||
        hasOrigin(destination, dropped.origin)
      ) {
        return;
      }
      route({
        contentLocale: dropped.contentLocale,
        origin: dropped.origin,
        platform: destination.platform,
        returnFocusId: `origin-handle-${originKey(dropped.origin)}`,
      });
      return;
    }

    const source = draftData(operation.source?.data);
    if (!source || !target) return;
    if (source.mediaBrandId !== target.mediaBrandId) return;

    if (source.laneKey !== target.laneKey) {
      const sourceLane = lanes.find((lane) => keyOf(lane) === source.laneKey);
      const card = sourceLane?.drafts.find(
        (draft) => draft.id === source.cardId,
      );
      if (!card) return;
      sendTo(card, target.platform, `draft-handle-${source.cardId}`);
      return;
    }

    const sortable = operation.source;
    if (!isSortable(sortable) || sortable.index === sortable.initialIndex) {
      return;
    }
    reorder(source.laneKey, source.cardId, sortable.index);
  };

  return (
    <DragDropProvider
      onDragEnd={onDragEnd}
      plugins={configurePlugins}
      sensors={[pointerSensor, KeyboardSensor]}
    >
      {children}
      <section
        aria-label={t("platformDraft.zone")}
        className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable lane region must be reachable without a pointer.
        tabIndex={0}
      >
        {lanes.map((lane) => (
          <PlatformLane
            key={keyOf(lane)}
            lane={lane}
            lanes={lanes}
            onSendTo={sendTo}
            platforms={platforms}
          />
        ))}
      </section>
    </DragDropProvider>
  );
}

function PlatformLane({
  lane,
  lanes,
  onSendTo,
  platforms,
}: {
  lane: PlatformDraftLaneValue;
  lanes: readonly PlatformDraftLaneValue[];
  onSendTo: (
    card: PlatformDraftCard,
    platform: Platform,
    returnFocusId: string,
  ) => void;
  platforms: readonly Platform[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const laneKey = keyOf(lane);
  const { isDropTarget, ref } = useDroppable<DragData>({
    accept: (source) => acceptsDraft(lane, source.data),
    data: {
      kind: "lane",
      laneKey,
      mediaBrandId: lane.mediaBrandId,
      platform: lane.platform,
    },
    id: `platform-lane-${laneKey}`,
  });

  return (
    <section
      aria-label={t("platformDraft.lane", {
        brand: lane.brandName,
        platform: t(`run.platform.${lane.platform}`),
      })}
      className="min-w-[18rem] max-w-88 shrink-0 snap-start border border-border bg-card data-drop-target:bg-accent/40 data-drop-target:ring-2 data-drop-target:ring-ring"
      data-drop-target={isDropTarget || undefined}
      data-platform-lane={laneKey}
      ref={ref}
    >
      <header className="border-border border-b px-3 py-2">
        <h3 className="font-medium text-sm">
          {t("platformDraft.lane", {
            brand: lane.brandName,
            platform: t(`run.platform.${lane.platform}`),
          })}
        </h3>
        <p className="text-muted-foreground text-xs">
          {t("platformDraft.count", { n: lane.drafts.length })}
        </p>
      </header>
      {lane.drafts.length === 0 ? (
        <p className="p-3 text-muted-foreground text-sm">
          {t("platformDraft.empty")}
        </p>
      ) : (
        lane.drafts.map((card, index) => (
          <SortablePlatformDraft
            card={card}
            index={index}
            key={card.id}
            lanes={lanes}
            laneKey={laneKey}
            onSendTo={onSendTo}
            platforms={platforms}
          />
        ))
      )}
    </section>
  );
}

function SortablePlatformDraft({
  card,
  index,
  lanes,
  laneKey,
  onSendTo,
  platforms,
}: {
  card: PlatformDraftCard;
  index: number;
  lanes: readonly PlatformDraftLaneValue[];
  laneKey: string;
  onSendTo: (
    card: PlatformDraftCard,
    platform: Platform,
    returnFocusId: string,
  ) => void;
  platforms: readonly Platform[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const data: DraftDragData = {
    kind: "draft",
    cardId: card.id,
    laneKey,
    mediaBrandId: card.mediaBrandId,
    origin: card.origin,
    platform: card.platform,
    title: card.originTitle,
  };
  const { handleRef, isDragging, ref } = useSortable<DraftDragData>({
    accept: (source) => draftData(source.data)?.laneKey === laneKey,
    data,
    group: laneKey,
    id: card.id,
    index,
    type: "platform-draft",
  });

  return (
    <div
      className="bg-card outline-none focus-visible:ring-1 focus-visible:ring-ring data-dragging:opacity-70 data-dragging:shadow-lg data-dragging:ring-2 data-dragging:ring-ring"
      data-dragging={isDragging || undefined}
      data-route-draft-id={card.id}
      id={`route-result-${card.id}`}
      ref={ref}
      tabIndex={-1}
    >
      <PlatformDraftLaneCard
        card={card}
        dragHandle={
          <Button
            aria-label={t("platformDraft.drag", { title: card.originTitle })}
            id={`draft-handle-${card.id}`}
            ref={handleRef}
            size="icon"
            type="button"
            variant="ghost"
          >
            <GripVerticalIcon aria-hidden="true" />
          </Button>
        }
        siblingRoutes={platforms.flatMap((platform) => {
          if (platform === card.platform) return [];
          const destination = lanes.find(
            (lane) =>
              lane.mediaBrandId === card.mediaBrandId &&
              lane.platform === platform,
          );
          const platformName = t(`run.platform.${platform}`);
          const buttonId = `platform-route-${card.id}-${platform}`;

          return [
            destination && hasOrigin(destination, card.origin) ? (
              <span className="text-muted-foreground text-xs" key={platform}>
                {t("platformDraft.alreadyRouted", { platform: platformName })}
              </span>
            ) : (
              <Button
                id={buttonId}
                key={platform}
                onClick={() => onSendTo(card, platform, buttonId)}
                size="xs"
                type="button"
                variant="outline"
              >
                {t("platformDraft.sendTo", { platform: platformName })}
              </Button>
            ),
          ];
        })}
      />
    </div>
  );
}

function routeError(
  t: ReturnType<typeof useTranslations<typeof EDITORIAL_NAMESPACE>>,
  code: string | undefined,
) {
  const keys: Record<
    string,
    | "route.error.invalid"
    | "route.error.notFound"
    | "route.error.reused"
    | "route.error.stale"
    | "route.error.transient"
  > = {
    VALIDATION_FAILED: "route.error.invalid",
    NOT_FOUND: "route.error.notFound",
    IDEMPOTENCY_KEY_REUSED: "route.error.reused",
    TEMPLATE_DRIFT: "route.error.stale",
    TRANSIENT_CONFLICT: "route.error.transient",
  };
  return t(keys[code ?? ""] ?? "route.error.unknown");
}

function keyOf(lane: PlatformDraftLaneValue) {
  return `${lane.mediaBrandId}:${lane.platform}`;
}

function sameOrigin(left: CardOriginReference, right: CardOriginReference) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "editorial_selection") {
    return (
      right.kind === "editorial_selection" &&
      left.editorialSelectionId === right.editorialSelectionId
    );
  }
  if (left.kind === "telegram_filter_result") {
    return (
      right.kind === "telegram_filter_result" &&
      left.telegramFilterResultId === right.telegramFilterResultId
    );
  }
  return right.kind === "promo_idea" && left.promoIdeaId === right.promoIdeaId;
}

function hasOrigin(lane: PlatformDraftLaneValue, origin: CardOriginReference) {
  return lane.drafts.some((draft) => sameOrigin(draft.origin, origin));
}

function acceptsDraft(lane: PlatformDraftLaneValue, value: unknown) {
  const dropped = originData(value);
  if (dropped) {
    return (
      dropped.brandKey === lane.brandKey && !hasOrigin(lane, dropped.origin)
    );
  }
  const source = draftData(value);
  return Boolean(
    source &&
      source.mediaBrandId === lane.mediaBrandId &&
      (source.laneKey === keyOf(lane) || !hasOrigin(lane, source.origin)),
  );
}

export function originKey(origin: CardOriginReference) {
  if (origin.kind === "editorial_selection") return origin.editorialSelectionId;
  if (origin.kind === "telegram_filter_result") {
    return origin.telegramFilterResultId;
  }
  return origin.promoIdeaId;
}

function originData(value: unknown): OriginDragData | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<OriginDragData>;
  if (
    candidate.kind !== "origin" ||
    typeof candidate.brandKey !== "string" ||
    typeof candidate.title !== "string"
  ) {
    return null;
  }
  const contentLocale = contentLocaleSchema.safeParse(candidate.contentLocale);
  const origin = cardOriginReferenceSchema.safeParse(candidate.origin);
  if (!contentLocale.success || !origin.success) return null;
  return {
    kind: "origin",
    brandKey: candidate.brandKey,
    contentLocale: contentLocale.data,
    origin: origin.data,
    title: candidate.title,
  };
}

function dragData(value: unknown): DragData | null {
  if (!value || typeof value !== "object" || !("kind" in value)) return null;
  const candidate = value as Partial<DragData>;
  const platform = platformSchema.safeParse(candidate.platform);
  if (
    !platform.success ||
    typeof candidate.laneKey !== "string" ||
    typeof candidate.mediaBrandId !== "string"
  ) {
    return null;
  }
  if (candidate.kind === "lane") {
    return {
      kind: "lane",
      laneKey: candidate.laneKey,
      mediaBrandId: candidate.mediaBrandId,
      platform: platform.data,
    };
  }
  if (
    candidate.kind !== "draft" ||
    typeof candidate.cardId !== "string" ||
    typeof candidate.title !== "string"
  ) {
    return null;
  }
  const origin = cardOriginReferenceSchema.safeParse(candidate.origin);
  if (!origin.success) return null;
  return {
    kind: "draft",
    cardId: candidate.cardId,
    laneKey: candidate.laneKey,
    mediaBrandId: candidate.mediaBrandId,
    origin: origin.data,
    platform: platform.data,
    title: candidate.title,
  };
}

function draftData(value: unknown): DraftDragData | null {
  const data = dragData(value);
  return data?.kind === "draft" ? data : null;
}
