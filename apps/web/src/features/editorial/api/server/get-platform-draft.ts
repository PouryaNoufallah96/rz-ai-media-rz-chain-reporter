import "server-only";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
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
import { readPlatformDrafts } from "../../db/queries";

export async function getPlatformDraft(platformDraftId: string) {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  const result = await readCachedPlatformDraft(
    workspaceId,
    session.user.id,
    platformDraftId,
    env.PUBLISHING_EMERGENCY_PAUSED,
    customerTimeZone,
    customerEditorial.drafting.image.models.filter((model) => model.enabled),
  );

  return result ? { ...result, readAt: new Date() } : null;
}

async function readCachedPlatformDraft(
  workspaceId: string,
  userId: string,
  platformDraftId: string,
  environmentForcedPause: boolean,
  timeZone: string,
  enabledImageModels: readonly { key: string; name: string }[],
) {
  "use cache";
  cacheTag(draftsTags.reads(workspaceId));
  cacheTag(workspaceCacheTag(workspaceId, "publishing"));
  cacheLife("minutes");

  const [result] = await readPlatformDrafts(
    rpcDb(),
    workspaceId,
    { platformDraftId },
    userId,
    environmentForcedPause,
    timeZone,
    enabledImageModels,
  );
  return result ?? null;
}
