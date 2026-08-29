import "server-only";

import { env } from "@rz-chain-reporter/env/server";
import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { customerTimeZone } from "@/lib/customer-template.server";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { publishingTags } from "../../db/cache/tags";
import { readPublishingControl, readPublishingHistory } from "../../db/queries";
import type { PublishingQuery } from "../../schemas/history";

export async function getPublishingHistory(query: PublishingQuery) {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return {
    ...(await readCachedPublishingHistory(workspaceId, session.user.id, query)),
    query,
    environmentForcedPause: env.PUBLISHING_EMERGENCY_PAUSED,
    installationTimeZone: customerTimeZone,
  };
}

async function readCachedPublishingHistory(
  workspaceId: string,
  userId: string,
  query: PublishingQuery,
) {
  "use cache";
  cacheTag(publishingTags.reads(workspaceId));
  cacheLife("minutes");
  const database = rpcDb();
  const [page, control] = await Promise.all([
    readPublishingHistory(database, workspaceId, userId, query),
    readPublishingControl(database, workspaceId),
  ]);
  return { page, control };
}
