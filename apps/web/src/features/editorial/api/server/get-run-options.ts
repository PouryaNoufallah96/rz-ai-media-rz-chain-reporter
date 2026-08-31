import "server-only";

import {
  ANALYSIS_RUN_WINDOW_HOURS,
  type RunConfiguration,
} from "@rz-chain-reporter/contracts";
import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import {
  customerAcquisition,
  customerEditorial,
} from "@/lib/customer-template.server";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { editorialTags } from "../../db/cache/tags";
import { readRunOptions } from "../../db/queries";
import type { PreviousRun, RunOptions } from "../../schemas/workspace";

export async function getRunOptions(): Promise<RunOptions> {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  const actorId = session.user.id;
  const { runs, recentTopics } = await readCachedRunOptions(
    workspaceId,
    actorId,
  );

  return {
    models: customerEditorial.models,
    brands: customerEditorial.brands,
    platforms: customerEditorial.platforms,
    defaults: {
      ...customerEditorial.defaults,
      orderingMode: customerAcquisition.orderingMode,
      topN: customerAcquisition.topN,
    },
    bounds: customerEditorial.bounds,
    windowHours: ANALYSIS_RUN_WINDOW_HOURS,
    runs: runs.map((run) => ({
      id: run.id,
      kind: run.kind,
      lifecycle: run.lifecycle,
      startedAt: run.startedAt,
      templateFingerprint: run.templateFingerprint,
    })),
    recentTopics,
    previousRun: previousCompatibleRun(runs),
  };
}

async function readCachedRunOptions(workspaceId: string, userId: string) {
  "use cache";
  cacheTag(editorialTags.reads(workspaceId));
  cacheLife("minutes");

  return readRunOptions(rpcDb(), workspaceId, userId);
}

function previousCompatibleRun(
  runs: readonly { id: string; configuration: RunConfiguration }[],
): PreviousRun | null {
  const { brandKeys, modelKeys, platforms, selectionCap } =
    customerEditorial.bounds;
  const liveBrands = new Set<string>(brandKeys);
  const liveModels = new Set<string>(modelKeys);
  const livePlatforms = new Set<string>(platforms);

  for (const { id, configuration } of runs) {
    const dropped: string[] = [];
    const keep = <TValue extends string>(
      values: readonly TValue[],
      live: ReadonlySet<string>,
    ) =>
      values.filter((value) => {
        if (live.has(value)) return true;
        dropped.push(value);
        return false;
      });

    const models = keep(configuration.models, liveModels);

    if (configuration.kind === "promo") {
      const brands = keep(configuration.promo.brands, liveBrands);
      const runPlatforms = keep(
        configuration.platforms ?? customerEditorial.platforms,
        livePlatforms,
      );
      if (
        models.length === 0 ||
        brands.length === 0 ||
        runPlatforms.length === 0
      )
        continue;

      return {
        id,
        dropped,
        configuration: {
          ...configuration,
          models,
          platforms: runPlatforms,
          promo: {
            brands,
            prompts: Object.fromEntries(
              brands.map((brand) => [
                brand,
                configuration.promo.prompts[brand] ?? "",
              ]),
            ),
          },
        },
      };
    }

    const brands = keep(configuration.brands, liveBrands);
    const runPlatforms = keep(configuration.platforms, livePlatforms);
    if (models.length === 0 || brands.length === 0 || runPlatforms.length === 0)
      continue;

    const topN =
      configuration.topN > selectionCap ? selectionCap : configuration.topN;
    if (topN !== configuration.topN) {
      dropped.push("topN");
    }

    return {
      id,
      dropped,
      configuration: {
        ...configuration,
        brands,
        models,
        platforms: runPlatforms,
        topN,
      },
    };
  }

  return null;
}
