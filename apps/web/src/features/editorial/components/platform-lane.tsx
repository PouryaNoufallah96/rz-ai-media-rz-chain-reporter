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
import { Hint } from "@rz-chain-reporter/ui/components/hint";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { ChevronDownIcon, ChevronUpIcon, GripVerticalIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  startTransition,
  use,
  useContext,
  useEffect,
  useOptimistic,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { useAction } from "@/hooks/use-action";

import {
  reorderPlatformDraftsAction,
  routePlatformDraftAction,
} from "../actions/commands";
import { EDITORIAL_NAMESPACE } from "../constants";
import type {
  PlatformDraftCard,
  PlatformDraftLane as PlatformDraftLaneValue,
} from "../schemas/drafts";
import { PendingPlatformRouteCard, PlatformDraftLaneCard } from "./lane-card";
import { LANE_WIDTH_CLASS_NAME } from "./lane-layout";
import {
  PlatformRouteButton,
  PlatformRouteStatus,
} from "./platform-route-control";
import { PresentationTranslationButton } from "./presentation-translation-button";

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
  brandKey: string;
  contentLocale: ContentLocale;
  origin: CardOriginReference;
  platform: Platform;
  returnFocusId: string;
  title: string;
};

type PendingRoutePrediction = {
  brandKey: string;
  id: string;
  origin: CardOriginReference;
  platform: Platform;
  title: string;
};

type RouteContextValue = {
  announce: (message: string) => void;
  isRouted: (
    brandKey: string,
    origin: CardOriginReference,
    platform: Platform,
  ) => boolean;
  isRoutePending: (
    brandKey: string,
    origin: CardOriginReference,
    platform: Platform,
  ) => boolean;
  pendingRoutes: readonly PendingRoutePrediction[];
  platforms: readonly Platform[];
  route: (request: RouteRequest) => void;
};

type PlatformBoardContextValue = {
  lanes: readonly PlatformDraftLaneValue[];
  move: (laneKey: string, cardId: string, destinationIndex: number) => void;
  onOpenCard: (card: PlatformDraftCard, trigger: HTMLButtonElement) => void;
  platforms: readonly Platform[];
  reorderPending: boolean;
  sendTo: (
    card: PlatformDraftCard,
    platform: Platform,
    returnFocusId: string,
  ) => void;
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
const PlatformBoardContext = createContext<PlatformBoardContextValue | null>(
  null,
);
const EMPTY_PENDING_ROUTES: readonly PendingRoutePrediction[] = [];

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

function usePlatformBoard() {
  const value = use(PlatformBoardContext);
  if (!value) throw new Error("Platform lanes require PlatformLanes");
  return value;
}

export function RouteProvider({
  children,
  defaultModelOptionKey,
  lanes,
  platforms,
}: {
  children: ReactNode;
  defaultModelOptionKey: string;
  lanes: readonly PlatformDraftLaneValue[];
  platforms: readonly Platform[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [announcement, setAnnouncement] = useState("");
  const [routeFailure, setRouteFailure] = useState("");
  const [pendingRoutes, addPendingRoute] = useOptimistic(
    EMPTY_PENDING_ROUTES,
    (
      currentRoutes,
      prediction: PendingRoutePrediction,
    ): readonly PendingRoutePrediction[] =>
      currentRoutes.some((current) => current.id === prediction.id)
        ? currentRoutes
        : [...currentRoutes, prediction],
  );
  const pendingRouteKeys = useRef(new Set<string>());
  const action = useAction(routePlatformDraftAction);

  const isRoutePending = (
    brandKey: string,
    origin: CardOriginReference,
    platform: Platform,
  ) => {
    const id = routeKey(brandKey, origin, platform);
    return (
      pendingRouteKeys.current.has(id) ||
      pendingRoutes.some((pending) => pending.id === id)
    );
  };

  const isRouted = (
    brandKey: string,
    origin: CardOriginReference,
    platform: Platform,
  ) =>
    lanes.some(
      (lane) =>
        lane.brandKey === brandKey &&
        lane.platform === platform &&
        hasOrigin(lane, origin),
    );

  const route = (request: RouteRequest) => {
    const { brandKey, contentLocale, origin, platform, returnFocusId, title } =
      request;
    const id = routeKey(brandKey, origin, platform);
    if (pendingRouteKeys.current.has(id)) return;

    pendingRouteKeys.current.add(id);
    setRouteFailure("");
    setAnnouncement(
      t("platformDraft.a11y.routing", {
        platform: t(`run.platform.${platform}`),
        title,
      }),
    );

    startTransition(async () => {
      addPendingRoute({ brandKey, id, origin, platform, title });
      requestAnimationFrame(() =>
        document.getElementById(returnFocusId)?.focus(),
      );

      const settled = await action.execute({
        origin,
        platform,
        modelOptionKey: defaultModelOptionKey,
        requestedContentLocale: contentLocale,
        idempotencyKey: crypto.randomUUID(),
      });
      pendingRouteKeys.current.delete(id);
      const message = settled.data
        ? t(
            settled.data.status === "reconciled"
              ? "route.existing"
              : "route.queued",
          )
        : routeError(t, settled.code);
      setAnnouncement(message);
      if (!settled.data) {
        setRouteFailure(message);
        toast.error(message);
      }
    });
  };

  return (
    <RouteContext
      value={{
        announce: setAnnouncement,
        isRouted,
        isRoutePending,
        pendingRoutes,
        platforms,
        route,
      }}
    >
      <p aria-atomic="true" className="sr-only" role="status">
        {announcement}
      </p>
      {routeFailure ? (
        <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive text-xs">
          {routeFailure}
        </p>
      ) : null}
      {children}
    </RouteContext>
  );
}

function reorderedDrafts(
  lanes: readonly PlatformDraftLaneValue[],
  laneKey: string,
  cardId: string,
  destinationIndex: number,
): {
  laneIndex: number;
  moved: PlatformDraftCard;
  ordered: PlatformDraftCard[];
} | null {
  const laneIndex = lanes.findIndex((lane) => keyOf(lane) === laneKey);
  const lane = lanes[laneIndex];
  if (!lane) return null;
  const sourceIndex = lane.drafts.findIndex((draft) => draft.id === cardId);
  if (sourceIndex < 0 || sourceIndex === destinationIndex) return null;

  const ordered = [...lane.drafts];
  const [moved] = ordered.splice(sourceIndex, 1);
  if (!moved) return null;
  ordered.splice(destinationIndex, 0, moved);

  return { laneIndex, moved, ordered };
}

function predictReorder(
  lanes: readonly PlatformDraftLaneValue[],
  { cardId, destinationIndex, laneKey }: ReorderPrediction,
) {
  const result = reorderedDrafts(lanes, laneKey, cardId, destinationIndex);
  if (!result) return lanes;
  const { laneIndex, ordered } = result;

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
  onOpenCard,
}: {
  children: ReactNode;
  lanes: readonly PlatformDraftLaneValue[];
  onOpenCard: (card: PlatformDraftCard, trigger: HTMLButtonElement) => void;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const uiLocale = useLocale();
  const { announce, isRoutePending, platforms, route } = useRouteContext();
  const [lanes, applyReorder] = useOptimistic(initialLanes, predictReorder);
  const [reorderConflict, setReorderConflict] = useState("");
  const [reorderPending, setReorderPending] = useState(false);
  const reorderPendingRef = useRef(false);
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
      dragover: ({ operation }) => {
        const source = operation.source;
        if (!isSortable(source)) return;
        const title =
          draftData(source.data)?.title ?? originData(source.data)?.title ?? "";
        return translatorRef.current("platformDraft.a11y.movedOver", {
          position: source.index + 1,
          title,
        });
      },
      dragend: ({ operation }) =>
        operation.canceled || !operation.target
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
    if (reorderPendingRef.current) return;
    const result = reorderedDrafts(lanes, laneKey, cardId, destinationIndex);
    if (!result) return;
    const { moved, ordered } = result;
    reorderPendingRef.current = true;
    setReorderPending(true);
    announce(
      t("platformDraft.a11y.moved", {
        position: destinationIndex + 1,
        title: moved.originTitle,
      }),
    );
    setReorderConflict("");

    startTransition(async () => {
      applyReorder({ cardId, destinationIndex, laneKey });
      requestAnimationFrame(() =>
        document.getElementById(`draft-handle-${moved.id}`)?.focus(),
      );
      const settled = await action.execute({
        platformDraftId: moved.id,
        orderedDrafts: ordered.map((draft) => ({
          id: draft.id,
          expectedVersion: draft.version,
        })),
      });
      if (settled.status === "error" || !settled.data) {
        const message = t("platformDraft.a11y.conflict");
        announce(message);
        setReorderConflict(message);
      }
      reorderPendingRef.current = false;
      setReorderPending(false);
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
    if (
      hasOrigin(destination, card.origin) ||
      isRoutePending(destination.brandKey, card.origin, platform)
    ) {
      announce(
        t("platformDraft.a11y.alreadyRouted", {
          platform: t(`run.platform.${platform}`),
        }),
      );
      return;
    }

    route({
      brandKey: card.brandKey,
      contentLocale: uiLocale,
      origin: card.origin,
      platform,
      returnFocusId,
      title: card.originTitle,
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
        hasOrigin(destination, dropped.origin) ||
        isRoutePending(
          destination.brandKey,
          dropped.origin,
          destination.platform,
        )
      ) {
        return;
      }
      route({
        brandKey: dropped.brandKey,
        contentLocale: dropped.contentLocale,
        origin: dropped.origin,
        platform: destination.platform,
        returnFocusId: `origin-handle-${originUiKey(dropped.brandKey, dropped.origin)}`,
        title: dropped.title,
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
    <PlatformBoardContext
      value={{
        lanes,
        move: reorder,
        onOpenCard,
        platforms,
        reorderPending,
        sendTo,
      }}
    >
      <DragDropProvider
        onDragEnd={onDragEnd}
        plugins={configurePlugins}
        sensors={[pointerSensor, KeyboardSensor]}
      >
        {reorderConflict ? (
          <p
            className="mb-3 rounded-lg border border-working/40 bg-working/10 p-3 text-working text-xs"
            role="status"
          >
            {reorderConflict}
          </p>
        ) : null}
        {children}
      </DragDropProvider>
    </PlatformBoardContext>
  );
}

export function PlatformLaneGroup({
  brandKey,
  brandName,
  platforms: requestedPlatforms,
}: {
  brandKey: string;
  brandName: string;
  platforms: readonly Platform[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const context = usePlatformBoard();
  const { pendingRoutes } = useRouteContext();

  return requestedPlatforms.map((platform) => {
    const lane = context.lanes.find(
      (candidate) =>
        candidate.brandKey === brandKey && candidate.platform === platform,
    );
    const pending = pendingRoutes.filter(
      (prediction) =>
        prediction.brandKey === brandKey && prediction.platform === platform,
    );

    return lane ? (
      <PlatformLane key={keyOf(lane)} lane={lane} />
    ) : (
      <section
        aria-label={t("platformDraft.lane", {
          brand: brandName,
          platform: t(`run.platform.${platform}`),
        })}
        className={cn(
          "flex min-h-48 shrink-0 snap-start flex-col rounded-lg bg-muted/60",
          LANE_WIDTH_CLASS_NAME,
        )}
        key={platform}
      >
        <header className="px-3 py-3">
          <h4 className="ticket-label">{t(`run.platform.${platform}`)}</h4>
        </header>
        {pending.length > 0 ? (
          pending.map((prediction) => (
            <PendingPlatformRouteCard
              key={prediction.id}
              title={prediction.title}
            />
          ))
        ) : (
          <p className="m-auto p-4 text-center text-muted-foreground text-sm">
            {t("platformDraft.placeholder")}
          </p>
        )}
      </section>
    );
  });
}

function PlatformLane({ lane }: { lane: PlatformDraftLaneValue }) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { isRoutePending, pendingRoutes } = useRouteContext();
  const laneKey = keyOf(lane);
  const pending = pendingRoutes.filter(
    (prediction) =>
      prediction.brandKey === lane.brandKey &&
      prediction.platform === lane.platform &&
      !hasOrigin(lane, prediction.origin),
  );
  const { isDropTarget, ref } = useDroppable<DragData>({
    accept: (source) => acceptsDraft(lane, source.data, isRoutePending),
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
      className={cn(
        "shrink-0 snap-start rounded-lg bg-muted/60 pb-2 data-drop-target:inset-ring-2 data-drop-target:inset-ring-ring data-drop-target:bg-accent/40",
        LANE_WIDTH_CLASS_NAME,
      )}
      data-drop-target={isDropTarget || undefined}
      data-platform-lane={laneKey}
      ref={ref}
    >
      <header className="px-3 py-3">
        <h4 className="wrap-anywhere font-medium text-sm">
          {t("platformDraft.lane", {
            brand: lane.brandName,
            platform: t(`run.platform.${lane.platform}`),
          })}
        </h4>
        <p className="text-muted-foreground text-xs">
          {t("platformDraft.count", { n: lane.drafts.length })}
        </p>
      </header>
      {lane.drafts.length === 0 && pending.length === 0 ? (
        <p className="p-3 text-muted-foreground text-sm">
          {t("platformDraft.empty")}
        </p>
      ) : (
        <>
          {lane.drafts.map((card, index) => (
            <SortablePlatformDraft
              card={card}
              index={index}
              key={card.id}
              laneKey={laneKey}
            />
          ))}
          {pending.map((prediction) => (
            <PendingPlatformRouteCard
              key={prediction.id}
              title={prediction.title}
            />
          ))}
        </>
      )}
    </section>
  );
}

function SortablePlatformDraft({
  card,
  index,
  laneKey,
}: {
  card: PlatformDraftCard;
  index: number;
  laneKey: string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { lanes, move, onOpenCard, platforms, reorderPending, sendTo } =
    usePlatformBoard();
  const { isRoutePending } = useRouteContext();
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
    disabled: reorderPending,
    group: laneKey,
    id: card.id,
    index,
    type: "platform-draft",
  });
  const laneLength =
    lanes.find((lane) => keyOf(lane) === laneKey)?.drafts.length ?? 0;

  return (
    <div
      className="mx-2 mb-2 rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-ring data-dragging:opacity-70 data-dragging:shadow-lg data-dragging:ring-2 data-dragging:ring-ring"
      data-dragging={isDragging || undefined}
      data-route-draft-id={card.id}
      id={`route-result-${card.id}`}
      ref={ref}
      tabIndex={-1}
    >
      <PlatformDraftLaneCard
        card={card}
        controls={
          <>
            <PresentationTranslationButton
              origin={card.origin}
              presentationReady={card.presentationReady}
              translation={card.presentationTranslation}
              title={card.originTitle}
            />
            <Hint label={t("platformDraft.hint.drag")}>
              <Button
                aria-label={t("platformDraft.drag", {
                  title: card.originTitle,
                })}
                aria-disabled={reorderPending}
                className="aria-disabled:pointer-events-none aria-disabled:opacity-50 max-compact:size-11"
                id={`draft-handle-${card.id}`}
                ref={handleRef}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <GripVerticalIcon aria-hidden="true" />
              </Button>
            </Hint>
            <Hint label={t("platformDraft.hint.moveEarlier")}>
              <Button
                aria-label={t("platformDraft.moveEarlier", {
                  title: card.originTitle,
                })}
                className="max-compact:size-11"
                disabled={reorderPending || index === 0}
                onClick={() => move(laneKey, card.id, index - 1)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <ChevronUpIcon aria-hidden="true" />
              </Button>
            </Hint>
            <Hint label={t("platformDraft.hint.moveLater")}>
              <Button
                aria-label={t("platformDraft.moveLater", {
                  title: card.originTitle,
                })}
                className="max-compact:size-11"
                disabled={reorderPending || index >= laneLength - 1}
                onClick={() => move(laneKey, card.id, index + 1)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <ChevronDownIcon aria-hidden="true" />
              </Button>
            </Hint>
          </>
        }
        onOpen={(trigger) => onOpenCard(card, trigger)}
        siblingRoutes={platforms.flatMap((platform) => {
          if (platform === card.platform) return [];
          const destination = lanes.find(
            (lane) =>
              lane.mediaBrandId === card.mediaBrandId &&
              lane.platform === platform,
          );
          const platformName = t(`run.platform.${platform}`);
          const buttonId = `platform-route-${card.id}-${platform}`;
          const routePending = isRoutePending(
            card.brandKey,
            card.origin,
            platform,
          );

          return [
            destination && hasOrigin(destination, card.origin) ? (
              <PlatformRouteStatus
                accessibleLabel={t("platformDraft.alreadyRouted", {
                  platform: platformName,
                })}
                key={platform}
                platform={platform}
              />
            ) : (
              <PlatformRouteButton
                accessibleLabel={
                  routePending
                    ? t("platformDraft.a11y.routing", {
                        platform: platformName,
                        title: card.originTitle,
                      })
                    : t("platformDraft.sendTo", { platform: platformName })
                }
                buttonId={buttonId}
                hint={
                  routePending
                    ? t("platformDraft.routingTo", {
                        platform: platformName,
                      })
                    : t("platformDraft.sendTo", { platform: platformName })
                }
                key={platform}
                onClick={() => sendTo(card, platform, buttonId)}
                pending={routePending}
                platform={platform}
              />
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

function acceptsDraft(
  lane: PlatformDraftLaneValue,
  value: unknown,
  isRoutePending: RouteContextValue["isRoutePending"],
) {
  const dropped = originData(value);
  if (dropped) {
    return (
      dropped.brandKey === lane.brandKey &&
      !hasOrigin(lane, dropped.origin) &&
      !isRoutePending(lane.brandKey, dropped.origin, lane.platform)
    );
  }
  const source = draftData(value);
  return Boolean(
    source &&
      source.mediaBrandId === lane.mediaBrandId &&
      (source.laneKey === keyOf(lane) ||
        (!hasOrigin(lane, source.origin) &&
          !isRoutePending(lane.brandKey, source.origin, lane.platform))),
  );
}

function routeKey(
  brandKey: string,
  origin: CardOriginReference,
  platform: Platform,
) {
  return JSON.stringify([brandKey, platform, origin.kind, originKey(origin)]);
}

function originKey(origin: CardOriginReference) {
  if (origin.kind === "editorial_selection") return origin.editorialSelectionId;
  if (origin.kind === "telegram_filter_result") {
    return origin.telegramFilterResultId;
  }
  return origin.promoIdeaId;
}

export function originUiKey(brandKey: string, origin: CardOriginReference) {
  return `${brandKey}-${originKey(origin)}`;
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
