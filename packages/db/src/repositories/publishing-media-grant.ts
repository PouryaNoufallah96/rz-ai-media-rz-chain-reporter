import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import { type Executor, withWorkspaceContext } from "../executor";
import { inWorkspace } from "../filters";
import { mediaAsset } from "../schema/media-asset";
import { publishingMediaGrant } from "../schema/publishing-media-grant";

export function hashPublishingMediaGrant(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function issuePublishingMediaGrant(
  executor: Executor,
  workspaceId: string,
  input: {
    publicationId: string;
    operationId: string;
    mediaAssetId: string;
    rawToken: string;
    expiresAt: Date;
  },
) {
  const tokenHash = hashPublishingMediaGrant(input.rawToken);
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [existing] = await tx
      .select()
      .from(publishingMediaGrant)
      .where(
        and(
          inWorkspace(publishingMediaGrant, workspaceId),
          eq(publishingMediaGrant.operationId, input.operationId),
          eq(publishingMediaGrant.mediaAssetId, input.mediaAssetId),
        ),
      )
      .for("update");
    if (existing) {
      if (existing.containerAcceptedAt || existing.revokedAt) {
        throw new Error("INSTAGRAM_GRANT_ALREADY_SETTLED");
      }
      const [rotated] = await tx
        .update(publishingMediaGrant)
        .set({
          tokenHash,
          expiresAt: input.expiresAt,
          version: existing.version + 1,
        })
        .where(
          and(
            inWorkspace(publishingMediaGrant, workspaceId),
            eq(publishingMediaGrant.id, existing.id),
            eq(publishingMediaGrant.version, existing.version),
          ),
        )
        .returning();
      if (!rotated) throw new Error("INSTAGRAM_GRANT_ROTATION_LOST");
      return rotated;
    }
    const [created] = await tx
      .insert(publishingMediaGrant)
      .values({
        workspaceId,
        publicationId: input.publicationId,
        operationId: input.operationId,
        mediaAssetId: input.mediaAssetId,
        tokenHash,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!created) throw new Error("INSTAGRAM_GRANT_INSERT_FAILED");
    return created;
  });
}

export async function fetchPublishingMediaGrant(
  executor: Executor,
  workspaceId: string,
  tokenHash: string,
  now: Date,
) {
  const [grant] = await executor
    .select({
      grant: publishingMediaGrant,
      asset: mediaAsset,
    })
    .from(publishingMediaGrant)
    .innerJoin(
      mediaAsset,
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.workspaceId, publishingMediaGrant.workspaceId),
        eq(mediaAsset.id, publishingMediaGrant.mediaAssetId),
        eq(mediaAsset.lifecycle, "verified"),
        isNull(mediaAsset.objectRemovedAt),
      ),
    )
    .where(
      and(
        inWorkspace(publishingMediaGrant, workspaceId),
        eq(publishingMediaGrant.tokenHash, tokenHash),
        gt(publishingMediaGrant.expiresAt, now),
        isNull(publishingMediaGrant.containerAcceptedAt),
        isNull(publishingMediaGrant.revokedAt),
      ),
    );
  return grant ?? null;
}

export async function acceptPublishingMediaGrantForContainer(
  executor: Executor,
  workspaceId: string,
  grantId: string,
) {
  const [updated] = await executor
    .update(publishingMediaGrant)
    .set({ containerAcceptedAt: new Date() })
    .where(
      and(
        inWorkspace(publishingMediaGrant, workspaceId),
        eq(publishingMediaGrant.id, grantId),
        isNull(publishingMediaGrant.containerAcceptedAt),
        isNull(publishingMediaGrant.revokedAt),
      ),
    )
    .returning();
  if (updated) return updated;
  const [existing] = await executor
    .select()
    .from(publishingMediaGrant)
    .where(
      and(
        inWorkspace(publishingMediaGrant, workspaceId),
        eq(publishingMediaGrant.id, grantId),
      ),
    );
  if (!existing?.containerAcceptedAt) {
    throw new Error("INSTAGRAM_GRANT_ACCEPT_FAILED");
  }
  return existing;
}
