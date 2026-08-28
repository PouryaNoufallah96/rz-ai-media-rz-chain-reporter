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
    query.run,
  );
  const readAt = new Date();

  if (!head) {
    return { ...lanes, head: null, query, readAt };
  }

  const { actorId, ...rest } = head;

  return {
    ...lanes,
    head: {
      ...rest,
      mine: actorId === session.user.id,
      templateChanged: rest.templateFingerprint !== customerTemplateFingerprint,
    },
    query,
    readAt,
  };
}

async function readPinnedEditorialWorkspace(
  workspaceId: string,
  analysisRunId: string,
) {
  "use cache";
  cacheTag(editorialTags.reads(workspaceId));
  cacheLife("minutes");

  return readEditorialWorkspace(rpcDb(), workspaceId, analysisRunId);
}
