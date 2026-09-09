import "server-only";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { revalidateTag } from "next/cache";

const TAGS_BY_MUTATION = {
  "editorial.cancelRun": ["editorial", "drafts"],
  "editorial.refreshArticleAndRegenerate": ["drafts"],
  "editorial.regenerateCopy": ["drafts"],
  "editorial.reorderDrafts": ["drafts"],
  "editorial.retryCopyGeneration": ["drafts"],
  "editorial.retryImageGeneration": ["drafts"],
  "editorial.routeDraft": ["drafts"],
  "editorial.startCopyVariantTranslation": ["drafts"],
  "editorial.startImageGeneration": ["drafts"],
  "editorial.startPresentationTranslation": ["editorial", "drafts"],
  "editorial.startRun": ["editorial", "drafts"],
  "editorial.updateDraftRevision": ["drafts"],
  "media.confirm": ["drafts"],
  "marketAnalysis.approveChart": ["market-analysis"],
  "marketAnalysis.approveDesign": ["market-analysis"],
  "marketAnalysis.approveFinal": ["market-analysis"],
  "marketAnalysis.approveStory": ["market-analysis"],
  "marketAnalysis.create": ["market-analysis"],
  "marketAnalysis.finish": ["market-analysis"],
  "marketAnalysis.generate": ["market-analysis"],
  "marketAnalysis.preparePlatform": ["market-analysis", "drafts", "publishing"],
  "marketAnalysis.retryCaptions": ["market-analysis", "drafts"],
  "marketAnalysis.retryChart": ["market-analysis"],
  "marketAnalysis.retryGenerationFinalization": ["market-analysis"],
  "marketAnalysis.saveChartDefault": ["market-analysis"],
  "marketAnalysis.updateMarketRequest": ["market-analysis"],
  "publishing.approve": ["publishing"],
  "publishing.attestTelegramPublication": ["publishing"],
  "publishing.cancelScheduledPublication": ["publishing"],
  "publishing.directPublish": ["publishing"],
  "publishing.discardCard": ["publishing"],
  "publishing.pausePublishing": ["publishing"],
  "publishing.reconcilePublication": ["publishing"],
  "publishing.recoverMissedPublication": ["publishing"],
  "publishing.reschedulePublication": ["publishing"],
  "publishing.restoreCard": ["publishing"],
  "publishing.resumePublishing": ["publishing"],
  "publishing.retryPublication": ["publishing"],
  "publishing.saveCard": ["publishing"],
  "publishing.schedulePublication": ["publishing"],
} as const;

function groupsFor(path: readonly string[]) {
  const key = path.join(".") as keyof typeof TAGS_BY_MUTATION;
  return TAGS_BY_MUTATION[key];
}

export function hasRpcMutationInvalidation(path: readonly string[]) {
  return groupsFor(path) !== undefined;
}

export function rpcMutationInvalidationTags(
  path: readonly string[],
  workspaceId: string,
) {
  return (groupsFor(path) ?? []).map((group) =>
    workspaceCacheTag(workspaceId, group),
  );
}

export function revalidateRpcMutation(
  path: readonly string[],
  workspaceId: string,
) {
  const tags = rpcMutationInvalidationTags(path, workspaceId);
  for (const tag of tags) {
    revalidateTag(tag, { expire: 0 });
  }
  return tags;
}
