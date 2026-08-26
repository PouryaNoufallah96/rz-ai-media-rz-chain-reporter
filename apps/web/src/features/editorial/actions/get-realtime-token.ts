"use server";

import {
  DRAFTS_REALTIME_CHANGED_TOPIC,
  EDITORIAL_REALTIME_CHANGED_TOPIC,
} from "@rz-chain-reporter/contracts";
import {
  draftsRealtimeChannel,
  editorialRealtimeChannel,
} from "@rz-chain-reporter/contracts/realtime-channels";

import { requireActionSession } from "@/features/auth/api/server/session";
import { mintSubscriptionToken } from "@/features/shared/realtime/subscription-token";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { readRunLifecycle } from "../db/queries";
import { analysisRunIdSchema } from "../schemas/workspace";

export async function getEditorialRealtimeTokens(analysisRunId: string) {
  await requireActionSession();

  const parsedRunId = analysisRunIdSchema.safeParse(analysisRunId);
  if (!parsedRunId.success) {
    return { status: "unavailable" as const };
  }

  const database = rpcDb();
  const workspaceId = await resolveInstallationWorkspaceId(database);

  if (!(await readRunLifecycle(database, workspaceId, parsedRunId.data))) {
    return { status: "unavailable" as const };
  }

  const [editorial, drafts] = await Promise.all([
    mintSubscriptionToken(
      editorialRealtimeChannel(workspaceId, parsedRunId.data),
      [EDITORIAL_REALTIME_CHANGED_TOPIC],
    ),
    mintSubscriptionToken(
      draftsRealtimeChannel(workspaceId, parsedRunId.data),
      [DRAFTS_REALTIME_CHANGED_TOPIC],
    ),
  ]);
  if (editorial.status === "unavailable" || drafts.status === "unavailable") {
    return { status: "unavailable" as const };
  }

  return {
    status: "available" as const,
    editorial: editorial.token,
    drafts: drafts.token,
  };
}
