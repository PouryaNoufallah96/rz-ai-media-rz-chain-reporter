import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import {
  decodeKeysetCursor,
  type OccurredAtCursor,
  occurredAtCursorSchema,
} from "@/features/shared/lib/keyset-cursor";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { accountTags } from "../../db/cache/tags";
import { readActivityLedger } from "../../db/queries";

export async function getActivityLedger(auditCursor: string | null) {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return readCachedActivityLedger(
    workspaceId,
    session.user.id,
    decodeKeysetCursor(occurredAtCursorSchema, auditCursor),
  );
}

async function readCachedActivityLedger(
  workspaceId: string,
  userId: string,
  cursor: OccurredAtCursor | null,
) {
  "use cache";
  cacheTag(accountTags.ledgerReads(workspaceId));
  cacheLife("minutes");
  return readActivityLedger(rpcDb(), workspaceId, userId, cursor);
}
