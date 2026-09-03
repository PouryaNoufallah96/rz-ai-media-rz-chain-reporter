import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { marketAnalysisTags } from "../../db/cache/tags";
import { readFeaturedMarketComparisons } from "../../db/queries";
import { marketTemplate } from "../../lib/template";
import type { MarketAnalysisCatalogProjection } from "../../schemas/reads";

export async function getMarketAnalysisCatalog() {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return readCachedMarketAnalysisCatalog(workspaceId, session.user.id);
}

async function readCachedMarketAnalysisCatalog(
  workspaceId: string,
  userId: string,
): Promise<MarketAnalysisCatalogProjection> {
  "use cache";
  cacheTag(marketAnalysisTags.reads(workspaceId));
  cacheLife("minutes");
  const featuredSymbols = marketTemplate.enabled
    ? [
        ...new Set([
          ...marketTemplate.featuredComparisonSymbols,
          marketTemplate.defaultComparisonSymbol,
        ]),
      ]
    : [];
  const catalog = await readFeaturedMarketComparisons(
    rpcDb(),
    workspaceId,
    userId,
    featuredSymbols,
  );
  return {
    entries: catalog.rows.map((entry) => ({
      canonicalIdentity: entry.canonicalIdentity,
      symbol: entry.symbol,
      displayName: entry.displayName,
      baseAsset: entry.baseAsset,
      quoteAsset: entry.quoteAsset,
    })),
    lastSuccessAt: catalog.state?.lastSuccessAt ?? null,
  };
}
