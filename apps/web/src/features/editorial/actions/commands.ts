"use server";

import { withMutationRefresh } from "@/features/shared/with-mutation-refresh";
import { createRequestContext } from "@/server/rpc/context";
import { rpcDb } from "@/server/rpc/db";
import {
  cancelRun,
  refreshArticleAndRegenerate,
  regenerateCopy,
  reorderDrafts,
  retryCopyGeneration,
  retryImageGeneration,
  routeDraft,
  startCopyVariantTranslation,
  startImageGeneration,
  startPresentationTranslation,
  startRun,
  updateDraftRevision,
} from "@/server/rpc/routers/editorial";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { updateDraftsTags, updateEditorialTags } from "../db/cache/tags";

const refreshDrafts = async () =>
  updateDraftsTags(await resolveInstallationWorkspaceId(rpcDb()));
const refreshEditorial = async () =>
  updateEditorialTags(await resolveInstallationWorkspaceId(rpcDb()));
const actionable = { context: createRequestContext } as const;

export const startAnalysisRunAction = withMutationRefresh(
  startRun.actionable(actionable),
  refreshEditorial,
);
export const cancelAnalysisRunAction = withMutationRefresh(
  cancelRun.actionable(actionable),
  refreshEditorial,
);
export const regenerateCopyAction = withMutationRefresh(
  regenerateCopy.actionable(actionable),
  refreshDrafts,
);
export const retryCopyGenerationAction = withMutationRefresh(
  retryCopyGeneration.actionable(actionable),
  refreshDrafts,
);
export const retryImageGenerationAction = withMutationRefresh(
  retryImageGeneration.actionable(actionable),
  refreshDrafts,
);
export const startImageGenerationAction = withMutationRefresh(
  startImageGeneration.actionable(actionable),
  refreshDrafts,
);
export const updateDraftRevisionAction = withMutationRefresh(
  updateDraftRevision.actionable(actionable),
  refreshDrafts,
);
export const refreshArticleAndRegenerateAction = withMutationRefresh(
  refreshArticleAndRegenerate.actionable(actionable),
  refreshDrafts,
);
export const routePlatformDraftAction = withMutationRefresh(
  routeDraft.actionable(actionable),
  refreshDrafts,
);
export const startPresentationTranslationAction = withMutationRefresh(
  startPresentationTranslation.actionable(actionable),
  refreshEditorial,
);
export const startCopyVariantTranslationAction = withMutationRefresh(
  startCopyVariantTranslation.actionable(actionable),
  refreshDrafts,
);
export const reorderPlatformDraftsAction = withMutationRefresh(
  reorderDrafts.actionable(actionable),
  refreshDrafts,
  { refreshOnError: true },
);
