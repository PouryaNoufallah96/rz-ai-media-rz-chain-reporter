"use client";

import type { ModelUnitStatus } from "@rz-chain-reporter/contracts";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from "@rz-chain-reporter/ui/components/empty";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { StateMark, type StateMarkState } from "@/components/common/state-mark";
import { OPERATIONS_NAMESPACE } from "@/features/operations/constants";
import { OPERATION_ERROR_KEYS } from "@/features/operations/lib/panel-state";

import { EDITORIAL_NAMESPACE } from "../constants";
import type { ModelLane, TelegramLane } from "../schemas/workspace";
import {
  PromoLaneCard,
  SelectionLaneCard,
  TelegramLaneCard,
} from "./lane-card";
import { LANE_WIDTH_CLASS_NAME } from "./lane-layout";

const UNIT_MARK: Record<ModelUnitStatus, StateMarkState> = {
  pending: "queued",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

export type ModelSlot = {
  brandKey: string;
  brandName: string;
  lane: ModelLane | null;
  modelName: string;
  modelOptionKey: string;
};

export function ModelLaneColumn({
  degraded,
  index,
  limitedGuidance,
  promo,
  slot,
  total,
  unitsPlanned,
}: {
  degraded: boolean;
  index: number;
  limitedGuidance: boolean;
  promo: boolean;
  slot: ModelSlot;
  total: number;
  unitsPlanned: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { brandName, lane, modelName } = slot;
  const title = t("lane.model.title", { brand: brandName, model: modelName });
  const fallback = lane?.invocationKey === "fallback";
  const cardCount =
    (promo ? lane?.promoIdeas.length : lane?.selections.length) ?? 0;
  const waitingForCards =
    cardCount === 0 &&
    (lane?.status === "pending" || lane?.status === "running");
  const recovered =
    lane?.status === "succeeded" && cardCount > 0 && lane.failureCode !== null;

  return (
    <LaneColumn
      count={cardCount}
      index={index}
      mark={
        lane ? <StateMark state={UNIT_MARK[lane.status ?? "pending"]} /> : null
      }
      status={
        <>
          {lane?.status ? (
            <span className={cn(lane.status === "succeeded" && "sr-only")}>
              {t(`lane.unit.${lane.status}`)}
            </span>
          ) : null}
          {lane === null && unitsPlanned ? (
            <Tag>{t("lane.noShortlist.tag")}</Tag>
          ) : null}
          {limitedGuidance ? <Tag>{t("lane.limitedGuidance.tag")}</Tag> : null}
          {lane?.failureCode ? (
            recovered ? (
              <span className="text-working">{t("lane.unit.recovered")}</span>
            ) : (
              <UnitFailure code={lane.failureCode} />
            )
          ) : null}
        </>
      }
      title={title}
      total={total}
    >
      {lane === null ? (
        unitsPlanned ? (
          <p className="p-2 text-muted-foreground text-xs">
            {t("lane.noShortlist.body")}
          </p>
        ) : (
          <LaneSkeleton />
        )
      ) : waitingForCards ? (
        <LaneSkeleton />
      ) : promo ? (
        <>
          {lane.promoIdeas.map((card) =>
            lane.unitId === null ? null : (
              <PromoLaneCard
                brandKey={slot.brandKey}
                brandName={brandName}
                card={card}
                fallback={fallback}
                key={card.id}
                limitedGuidance={limitedGuidance}
              />
            ),
          )}
          {lane.promoIdeas.length === 0 ? (
            <LaneEmpty promo status={lane.status} />
          ) : null}
        </>
      ) : (
        <>
          {lane.selections.map((card) => (
            <SelectionLaneCard
              brandKey={slot.brandKey}
              card={card}
              degraded={degraded}
              fallback={fallback}
              key={card.id}
            />
          ))}
          {lane.selections.length === 0 ? (
            <LaneEmpty status={lane.status} />
          ) : null}
        </>
      )}
    </LaneColumn>
  );
}

export function TelegramLaneColumn({
  alsoIn,
  degraded,
  index,
  lane,
  topics,
  total,
}: {
  alsoIn: ReadonlyMap<string, readonly string[]>;
  degraded: boolean;
  index: number;
  lane: TelegramLane;
  topics: readonly string[];
  total: number;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <LaneColumn
      count={lane.cards.length}
      index={index}
      mark={null}
      status={null}
      title={t("lane.telegram.title", { brand: lane.brandName })}
      total={total}
    >
      {lane.cards.map((card) => (
        <TelegramLaneCard
          alsoIn={
            alsoIn
              .get(card.sourceItemId)
              ?.filter((brand) => brand !== lane.brandName) ?? EMPTY_BRANDS
          }
          brandKey={lane.brandKey}
          card={card}
          degraded={degraded}
          key={card.sourceItemId}
          topics={topics}
        />
      ))}
    </LaneColumn>
  );
}

const EMPTY_BRANDS: readonly string[] = [];

function LaneColumn({
  children,
  count,
  index,
  mark,
  status,
  title,
  total,
}: {
  children: ReactNode;
  count: number;
  index: number;
  mark: ReactNode;
  status: ReactNode;
  title: string;
  total: number;
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <section
      aria-label={title}
      className={cn(
        "flex shrink-0 snap-start flex-col rounded-lg bg-muted/60",
        LANE_WIDTH_CLASS_NAME,
      )}
    >
      <header className="px-3 py-3">
        <div className="flex items-start gap-2">
          {mark}
          <h4 className="ticket-label wrap-anywhere min-w-0 flex-1">{title}</h4>
          <span className="rounded-md bg-background px-1.5 text-muted-foreground text-xs tabular-nums">
            {format.number(count)}
          </span>
        </div>
        <p className="mt-1 flex flex-wrap gap-1 text-muted-foreground text-xs">
          {status}
          <span className="compact:hidden">
            {t("lane.position", { i: index + 1, n: total })}
          </span>
        </p>
      </header>
      <div className="grid flex-1 content-start gap-2 p-2 pt-0">{children}</div>
    </section>
  );
}

function LaneEmpty({
  promo = false,
  status,
}: {
  promo?: boolean;
  status: ModelUnitStatus | null;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <Empty className="p-4">
      <EmptyHeader>
        <EmptyTitle className="text-sm">
          {t(
            status === "failed"
              ? "lane.empty.modelOutput"
              : promo
                ? "lane.empty.promoIdea"
                : "lane.empty.selection",
          )}
        </EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <Badge className="whitespace-normal font-normal" variant="secondary">
      {children}
    </Badge>
  );
}

function LaneSkeleton() {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  return (
    <div aria-busy="true" className="grid gap-2 p-2">
      <span className="sr-only" role="status">
        {t("table.loading")}
      </span>
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton className="h-12 w-full" key={index} pace="live" />
      ))}
    </div>
  );
}

function UnitFailure({ code }: { code: keyof typeof OPERATION_ERROR_KEYS }) {
  const editorial = useTranslations(EDITORIAL_NAMESPACE);
  const operations = useTranslations(OPERATIONS_NAMESPACE);

  return (
    <span className="text-destructive">
      {code === "STRUCTURED_OUTPUT_INVALID"
        ? editorial("lane.unit.invalidOutput")
        : operations(OPERATION_ERROR_KEYS[code])}
    </span>
  );
}
