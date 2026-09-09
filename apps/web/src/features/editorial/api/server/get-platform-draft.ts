import "server-only";

import type { ContentLocale } from "@rz-chain-reporter/contracts";
import { env } from "@rz-chain-reporter/env/server";
import { cacheLife, cacheTag } from "next/cache";
import { requireSession } from "@/features/auth/api/server/session";
import { currentLocale } from "@/i18n/server";
import { customerTimeZone } from "@/lib/customer-template.server";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";
import { draftsTags } from "../../db/cache/tags";
import { readPlatformDrafts } from "../../db/queries";

export async function getPlatformDraft(
  platformDraftId: string,
  presentationLocale?: ContentLocale,
) {
  const [session, resolvedPresentationLocale, workspaceId] = await Promise.all([
    requireSession(),
    presentationLocale ?? currentLocale(),
    resolveInstallationWorkspaceId(rpcDb()),
  ]);
  const result = await readCachedPlatformDraft(
    workspaceId,
    session.user.id,
    platformDraftId,
    env.PUBLISHING_EMERGENCY_PAUSED,
    customerTimeZone,
    resolvedPresentationLocale,
  );

  return result ? { ...result, readAt: new Date() } : null;
}

async function readCachedPlatformDraft(
  workspaceId: string,
  userId: string,
  platformDraftId: string,
  environmentForcedPause: boolean,
  timeZone: string,
  presentationLocale: ContentLocale,
) {
  "use cache";
  cacheTag(...draftsTags.platformDraftReads(workspaceId));
  cacheLife("minutes");

  const [result] = await readPlatformDrafts(
    rpcDb(),
    workspaceId,
    { platformDraftId },
    userId,
    environmentForcedPause,
    timeZone,
    presentationLocale,
  );
  return result ?? null;
}
