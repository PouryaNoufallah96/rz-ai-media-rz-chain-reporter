import "server-only";

import type { Executor } from "@rz-chain-reporter/db/executor";
import { inWorkspace } from "@rz-chain-reporter/db/filters";
import { analysisModelUnit } from "@rz-chain-reporter/db/schema/analysis-model-unit";
import { analysisRun } from "@rz-chain-reporter/db/schema/analysis-run";
import { editorialSelection } from "@rz-chain-reporter/db/schema/editorial-selection";
import { filterResult } from "@rz-chain-reporter/db/schema/filter-result";
import { mediaBrand } from "@rz-chain-reporter/db/schema/media-brand";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { source } from "@rz-chain-reporter/db/schema/source";
import { and, asc, countDistinct, desc, eq, inArray } from "drizzle-orm";

import { customerEditorial } from "@/lib/customer-template.server";

import { MAX_RUN_LANES, MAX_RUN_SOURCES } from "../constants";

export type AssistantRunContext = {
  id: string;
  kind: "news" | "promo";
  status: string;
  startedAt: Date;
  brands: readonly string[];
  sources: readonly string[];
  moreSources: number;
  lanes: readonly {
    brand: string;
    model: string;
    status: string;
    cards: number;
  }[];
  moreLanes: number;
  telegramLanes: readonly { brand: string; cards: number }[];
};

// Bounded and read-only: one head row, capped source names, and grouped lane
// counts. Lane contents never enter the prompt.
export async function readRunContext(
  executor: Executor,
  workspaceId: string,
  userId: string,
  claimedRunId: string | null,
): Promise<AssistantRunContext | null> {
  // A claimed run id the operator does not own matches nothing and falls back
  // to the newest run of theirs instead of failing the turn.
  const head =
    (claimedRunId
      ? await readHead(executor, workspaceId, userId, claimedRunId)
      : null) ?? (await readHead(executor, workspaceId, userId, null));

  if (!head) {
    return null;
  }

  const { configuration } = head;
  const sourceIds =
    configuration.kind === "news" ? configuration.sourceIds : [];

  const [sources, lanes, telegramLanes] = await Promise.all([
    readSourceNames(executor, workspaceId, sourceIds),
    readLanes(executor, workspaceId, head.id),
    readTelegramLanes(executor, workspaceId, head.id),
  ]);

  return {
    id: head.id,
    kind: configuration.kind,
    status: head.status,
    startedAt: head.startedAt,
    brands: (configuration.kind === "news"
      ? configuration.brands
      : configuration.promo.brands
    ).map(brandName),
    sources,
    moreSources: Math.max(sourceIds.length - sources.length, 0),
    lanes: lanes.slice(0, MAX_RUN_LANES),
    moreLanes: Math.max(lanes.length - MAX_RUN_LANES, 0),
    telegramLanes,
  };
}

function brandName(brandKey: string) {
  return (
    customerEditorial.brands.find((brand) => brand.key === brandKey)?.name ??
    brandKey
  );
}

async function readHead(
  executor: Executor,
  workspaceId: string,
  userId: string,
  analysisRunId: string | null,
) {
  const [head] = await executor
    .select({
      id: analysisRun.id,
      kind: analysisRun.kind,
      status: operation.lifecycle,
      startedAt: analysisRun.startedAt,
      configuration: analysisRun.configuration,
    })
    .from(analysisRun)
    .innerJoin(operation, eq(operation.id, analysisRun.operationId))
    .where(
      analysisRunId
        ? and(
            inWorkspace(analysisRun, workspaceId),
            eq(analysisRun.id, analysisRunId),
            eq(operation.actor, userId),
          )
        : and(
            inWorkspace(analysisRun, workspaceId),
            eq(operation.actor, userId),
          ),
    )
    .orderBy(desc(analysisRun.startedAt), desc(analysisRun.id))
    .limit(1);

  return head ?? null;
}

async function readSourceNames(
  executor: Executor,
  workspaceId: string,
  sourceIds: readonly string[],
) {
  if (sourceIds.length === 0) {
    return [];
  }

  const rows = await executor
    .select({ name: source.name })
    .from(source)
    .where(
      and(inWorkspace(source, workspaceId), inArray(source.id, [...sourceIds])),
    )
    .orderBy(asc(source.name))
    .limit(MAX_RUN_SOURCES);

  return rows.map((row) => row.name);
}

async function readLanes(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
) {
  return executor
    .select({
      brand: mediaBrand.name,
      model: analysisModelUnit.modelOptionKey,
      status: analysisModelUnit.status,
      cards: countDistinct(editorialSelection.id),
    })
    .from(analysisModelUnit)
    .innerJoin(
      mediaBrand,
      and(
        inWorkspace(mediaBrand, workspaceId),
        eq(mediaBrand.id, analysisModelUnit.mediaBrandId),
      ),
    )
    .leftJoin(
      editorialSelection,
      and(
        inWorkspace(editorialSelection, workspaceId),
        eq(editorialSelection.analysisModelUnitId, analysisModelUnit.id),
      ),
    )
    .where(
      and(
        inWorkspace(analysisModelUnit, workspaceId),
        eq(analysisModelUnit.analysisRunId, analysisRunId),
      ),
    )
    .groupBy(
      mediaBrand.name,
      analysisModelUnit.modelOptionKey,
      analysisModelUnit.status,
    )
    .orderBy(asc(mediaBrand.name), asc(analysisModelUnit.modelOptionKey));
}

async function readTelegramLanes(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
) {
  return executor
    .select({
      brand: mediaBrand.name,
      cards: countDistinct(filterResult.sourceItemId),
    })
    .from(filterResult)
    .innerJoin(
      mediaBrand,
      and(
        inWorkspace(mediaBrand, workspaceId),
        eq(mediaBrand.id, filterResult.mediaBrandId),
      ),
    )
    .where(
      and(
        inWorkspace(filterResult, workspaceId),
        eq(filterResult.analysisRunId, analysisRunId),
        eq(filterResult.disposition, "telegram_lane"),
      ),
    )
    .groupBy(mediaBrand.name)
    .orderBy(asc(mediaBrand.name));
}
