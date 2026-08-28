import "server-only";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import {
  type HistoryCursor,
  historyCursorSchema,
} from "@/features/publishing/schemas/history";
import { decodeKeysetCursor } from "@/features/shared/lib/keyset-cursor";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { readActivityLedger } from "../../db/queries";

export async function getActivityLedger(auditCursor: string | null) {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return readCachedActivityLedger(
    workspaceId,
    session.user.id,
    decodeKeysetCursor(historyCursorSchema, auditCursor),
  );
}

async function readCachedActivityLedger(
  workspaceId: string,
  userId: string,
  cursor: HistoryCursor | null,
) {
  "use cache";
  cacheTag(workspaceCacheTag(workspaceId, "publishing"));
  cacheLife("minutes");
  return readActivityLedger(rpcDb(), workspaceId, userId, cursor);
}
