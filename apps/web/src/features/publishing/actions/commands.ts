"use server";

import { withMutationRefresh } from "@/features/shared/with-mutation-refresh";
import { createRequestContext } from "@/server/rpc/context";
import { rpcDb } from "@/server/rpc/db";
import {
  approve,
  attestTelegramPublication,
  cancelScheduledPublication,
  directPublish,
  discardCard,
  pausePublishing,
  reconcilePublication,
  recoverMissedPublication,
  reschedulePublication,
  restoreCard,
  resumePublishing,
  retryPublication,
  saveCard,
  schedulePublication,
} from "@/server/rpc/routers/publishing";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { updatePublishingTags } from "../db/cache/tags";

const refreshPublishing = async () =>
  updatePublishingTags(await resolveInstallationWorkspaceId(rpcDb()));
const actionable = { context: createRequestContext } as const;

export const saveCardAction = withMutationRefresh(
  saveCard.actionable(actionable),
  refreshPublishing,
);
export const discardCardAction = withMutationRefresh(
  discardCard.actionable(actionable),
  refreshPublishing,
);
export const restoreCardAction = withMutationRefresh(
  restoreCard.actionable(actionable),
  refreshPublishing,
);
export const approveAction = withMutationRefresh(
  approve.actionable(actionable),
  refreshPublishing,
);
export const directPublishAction = withMutationRefresh(
  directPublish.actionable(actionable),
  refreshPublishing,
);
export const schedulePublicationAction = withMutationRefresh(
  schedulePublication.actionable(actionable),
  refreshPublishing,
);
export const cancelScheduledPublicationAction = withMutationRefresh(
  cancelScheduledPublication.actionable(actionable),
  refreshPublishing,
);
export const reschedulePublicationAction = withMutationRefresh(
  reschedulePublication.actionable(actionable),
  refreshPublishing,
  { refreshOnError: true },
);
export const recoverMissedPublicationAction = withMutationRefresh(
  recoverMissedPublication.actionable(actionable),
  refreshPublishing,
  { refreshOnError: true },
);
export const retryPublicationAction = withMutationRefresh(
  retryPublication.actionable(actionable),
  refreshPublishing,
);
export const reconcilePublicationAction = withMutationRefresh(
  reconcilePublication.actionable(actionable),
  refreshPublishing,
);
export const attestTelegramPublicationAction = withMutationRefresh(
  attestTelegramPublication.actionable(actionable),
  refreshPublishing,
);
export const pausePublishingAction = withMutationRefresh(
  pausePublishing.actionable(actionable),
  refreshPublishing,
);
export const resumePublishingAction = withMutationRefresh(
  resumePublishing.actionable(actionable),
  refreshPublishing,
);
