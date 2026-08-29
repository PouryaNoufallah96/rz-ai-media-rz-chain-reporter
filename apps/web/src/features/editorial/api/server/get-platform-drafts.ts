import "server-only";

import type { Platform } from "@rz-chain-reporter/contracts";
import { env } from "@rz-chain-reporter/env/server";
import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import {
  customerEditorial,
  customerTimeZone,
} from "@/lib/customer-template.server";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { draftsTags } from "../../db/cache/tags";
import {
  readPlatformDraftBrands,
  readPlatformDraftRunConfiguration,
  readPlatformDrafts,
} from "../../db/queries";
import type { PlatformDraftLane } from "../../schemas/drafts";

export async function getPlatformDrafts(
  analysisRunId: string,
): Promise<PlatformDraftLane[]> {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());

  return readCachedPlatformDrafts(
    workspaceId,
    session.user.id,
    env.PUBLISHING_EMERGENCY_PAUSED,
    customerTimeZone,
    analysisRunId,
    customerEditorial.brands,
    customerEditorial.platforms,
  );
}

async function readCachedPlatformDrafts(
  workspaceId: string,
  userId: string,
  environmentForcedPause: boolean,
  timeZone: string,
  analysisRunId: string,
  enabledBrands: readonly { key: string; name: string }[],
  enabledPlatforms: readonly Platform[],
): Promise<PlatformDraftLane[]> {
  "use cache";
  cacheTag(...draftsTags.platformDraftReads(workspaceId));
  cacheLife("minutes");

  const [configuration, storedBrands, drafts] = await Promise.all([
    readPlatformDraftRunConfiguration(
      rpcDb(),
      workspaceId,
      analysisRunId,
      userId,
    ),
    readPlatformDraftBrands(rpcDb(), workspaceId),
    readPlatformDrafts(
      rpcDb(),
      workspaceId,
      { analysisRunId },
      userId,
      environmentForcedPause,
      timeZone,
    ),
  ]);
  if (!configuration) return [];
  const draftCards = drafts.map((draft) => draft.card);

  const brandByKey = new Map(storedBrands.map((brand) => [brand.key, brand]));
  const enabledBrandKeys = new Set(enabledBrands.map((brand) => brand.key));
  const selectedBrandKeys = [
    ...new Set(
      configuration.kind === "news"
        ? configuration.brands
        : configuration.promo.brands,
    ),
  ];
  const selectedPlatforms = [
    ...new Set(
      configuration.kind === "news"
        ? configuration.platforms
        : enabledPlatforms,
    ),
  ];

  return selectedBrandKeys.flatMap((brandKey) => {
    if (!enabledBrandKeys.has(brandKey)) return [];
    const brand = brandByKey.get(brandKey);
    if (!brand) return [];

    return selectedPlatforms.map((platform) => ({
      mediaBrandId: brand.id,
      brandKey: brand.key,
      brandName: brand.name,
      platform,
      drafts: draftCards.filter(
        (draft) =>
          draft.mediaBrandId === brand.id && draft.platform === platform,
      ),
    }));
  });
}
