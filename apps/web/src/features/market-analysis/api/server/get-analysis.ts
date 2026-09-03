import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { getPlatformDraft } from "@/features/editorial/api/server/get-platform-draft";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { marketAnalysisTags } from "../../db/cache/tags";
import { readMarketAnalysisProjection } from "../../db/queries";

export async function getMarketAnalysis(analysisId: string) {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  const analysis = await readCachedMarketAnalysis(
    workspaceId,
    session.user.id,
    analysisId,
  );
  if (!analysis) return null;
  const drafts = await Promise.all(
    analysis.linkedDrafts.map(({ draftId }) => getPlatformDraft(draftId)),
  );
  return {
    ...analysis,
    platformDrafts: drafts.flatMap((draft) => (draft ? [draft.card] : [])),
  };
}

async function readCachedMarketAnalysis(
  workspaceId: string,
  userId: string,
  analysisId: string,
) {
  "use cache";
  cacheTag(marketAnalysisTags.reads(workspaceId));
  cacheLife("minutes");
  return readMarketAnalysisProjection(rpcDb(), workspaceId, userId, analysisId);
}
