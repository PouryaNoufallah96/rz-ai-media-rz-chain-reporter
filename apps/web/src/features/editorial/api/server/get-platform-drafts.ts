import "server-only";

import type { Platform } from "@rz-chain-reporter/contracts";
import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { customerEditorial } from "@/lib/customer-template.server";
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
  await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());

  return readCachedPlatformDrafts(
    workspaceId,
    analysisRunId,
    customerEditorial.brands,
    customerEditorial.platforms,
    customerEditorial.drafting.image.models.filter((model) => model.enabled),
  );
}

async function readCachedPlatformDrafts(
  workspaceId: string,
  analysisRunId: string,
  enabledBrands: readonly { key: string; name: string }[],
  enabledPlatforms: readonly Platform[],
  enabledImageModels: readonly { key: string; name: string }[],
): Promise<PlatformDraftLane[]> {
  "use cache";
  cacheTag(draftsTags.reads(workspaceId));
  cacheLife("minutes");

  const [configuration, storedBrands, drafts] = await Promise.all([
    readPlatformDraftRunConfiguration(rpcDb(), workspaceId, analysisRunId),
    readPlatformDraftBrands(rpcDb(), workspaceId),
    readPlatformDrafts(rpcDb(), workspaceId, analysisRunId, enabledImageModels),
  ]);
  if (!configuration) return [];

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
      drafts: drafts.filter(
        (draft) =>
          draft.mediaBrandId === brand.id && draft.platform === platform,
      ),
    }));
  });
}
