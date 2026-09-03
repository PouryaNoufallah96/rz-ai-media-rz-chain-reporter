import { MARKET_GENERATION_FINAL_MEDIA_KIND } from "@rz-chain-reporter/contracts";
import { and, eq, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Transaction } from "../executor";
import { inWorkspace } from "../filters";
import { draftRevision } from "../schema/draft-revision";
import { imageGeneration } from "../schema/image-generation";
import { marketAnalysisHandoff } from "../schema/market-analysis";
import { mediaAsset } from "../schema/media-asset";
import { platformDraft } from "../schema/platform-draft";

export async function lockPublishableMedia(
  tx: Transaction,
  workspaceId: string,
  platformDraftId: string,
  mediaAssetId: string,
) {
  const generatedRevision = alias(draftRevision, "generated_revision");
  const [asset] = await tx
    .select({
      id: mediaAsset.id,
      kind: mediaAsset.kind,
      cleanupAfter: mediaAsset.cleanupAfter,
      version: mediaAsset.version,
    })
    .from(mediaAsset)
    .leftJoin(
      imageGeneration,
      and(
        inWorkspace(imageGeneration, workspaceId),
        eq(imageGeneration.finalMediaAssetId, mediaAsset.id),
      ),
    )
    .leftJoin(
      generatedRevision,
      and(
        inWorkspace(generatedRevision, workspaceId),
        eq(generatedRevision.id, imageGeneration.draftRevisionId),
      ),
    )
    .innerJoin(
      platformDraft,
      and(
        inWorkspace(platformDraft, workspaceId),
        eq(platformDraft.id, platformDraftId),
      ),
    )
    .leftJoin(
      marketAnalysisHandoff,
      and(
        inWorkspace(marketAnalysisHandoff, workspaceId),
        eq(marketAnalysisHandoff.id, platformDraft.marketAnalysisHandoffId),
      ),
    )
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, mediaAssetId),
        eq(mediaAsset.lifecycle, "verified"),
        isNull(mediaAsset.objectRemovedAt),
        or(
          eq(mediaAsset.kind, "image"),
          and(
            eq(mediaAsset.kind, "image_final"),
            eq(generatedRevision.platformDraftId, platformDraftId),
          ),
          and(
            eq(mediaAsset.kind, MARKET_GENERATION_FINAL_MEDIA_KIND),
            eq(marketAnalysisHandoff.finalMediaAssetId, mediaAsset.id),
          ),
        ),
      ),
    )
    .for("update", { of: mediaAsset });
  return asset;
}
