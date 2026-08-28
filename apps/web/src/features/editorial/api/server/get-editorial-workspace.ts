import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { customerTemplateFingerprint } from "@/lib/customer-template.server";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { editorialTags } from "../../db/cache/tags";
import { readEditorialWorkspace } from "../../db/queries";
import {
  type EditorialWorkspace,
  loadWorkspaceSearchParams,
  normalizeWorkspaceQuery,
  type WorkspaceSearchParams,
} from "../../schemas/workspace";

export async function getEditorialWorkspace(
  searchParams: WorkspaceSearchParams,
): Promise<EditorialWorkspace> {
  const session = await requireSession();
  const query = normalizeWorkspaceQuery(
    await loadWorkspaceSearchParams(searchParams),
  );

  if (query.run === null) {
    return {
      head: null,
      modelLanes: [],
      telegramLanes: [],
      query,
      readAt: new Date(),
    };
  }

  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  const { head, ...lanes } = await readPinnedEditorialWorkspace(
    workspaceId,
    session.user.id,
    query.run,
  );
  const readAt = new Date();

  if (!head) {
    return {
      head: null,
      modelLanes: [],
      telegramLanes: [],
      query,
      readAt,
    };
  }

  return {
    ...lanes,
    head: {
      ...head,
      templateChanged: head.templateFingerprint !== customerTemplateFingerprint,
    },
    query,
    readAt,
  };
}

async function readPinnedEditorialWorkspace(
  workspaceId: string,
  userId: string,
  analysisRunId: string,
) {
  "use cache";
  cacheTag(editorialTags.reads(workspaceId));
  cacheLife("minutes");

  return readEditorialWorkspace(rpcDb(), workspaceId, userId, analysisRunId);
}
