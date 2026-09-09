import "server-only";

import type { ContentLocale } from "@rz-chain-reporter/contracts";
import { getEditorialWorkspace } from "@/features/editorial/api/server/get-editorial-workspace";
import { getSourceCatalog } from "@/features/sources/api/server/get-source-catalog";

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
  claimedRunId: string | null,
  presentationLocale: ContentLocale,
): Promise<AssistantRunContext | null> {
  if (!claimedRunId) return null;

  const [workspace, sourceCatalog] = await Promise.all([
    getEditorialWorkspace(
      Promise.resolve({ run: claimedRunId }),
      presentationLocale,
    ),
    getSourceCatalog(),
  ]);
  const { head } = workspace;

  if (!head) {
    return null;
  }

  const { configuration } = head;
  const sourceIds =
    configuration.kind === "news" ? configuration.sourceIds : [];
  const selectedSources = new Set(sourceIds);
  const sources: string[] = [];
  for (const source of sourceCatalog.entries) {
    if (!selectedSources.has(source.id)) continue;
    sources.push(source.name);
    if (sources.length === MAX_RUN_SOURCES) break;
  }
  const lanes = workspace.modelLanes.map((lane) => ({
    brand: lane.brandName,
    model: lane.modelOptionKey,
    status: lane.status ?? "pending",
    cards: lane.selections.length + lane.promoIdeas.length,
  }));

  return {
    id: head.id,
    kind: configuration.kind,
    status: head.lifecycle,
    startedAt: head.startedAt,
    brands: (configuration.kind === "news"
      ? configuration.brands
      : configuration.promo.brands
    ).map(brandName),
    sources,
    moreSources: Math.max(sourceIds.length - sources.length, 0),
    lanes: lanes.slice(0, MAX_RUN_LANES),
    moreLanes: Math.max(lanes.length - MAX_RUN_LANES, 0),
    telegramLanes: workspace.telegramLanes.map((lane) => ({
      brand: lane.brandName,
      cards: lane.cards.length,
    })),
  };
}

export function brandName(brandKey: string) {
  return (
    customerEditorial.brands.find((brand) => brand.key === brandKey)?.name ??
    brandKey
  );
}
