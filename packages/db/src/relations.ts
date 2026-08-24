import { relations } from "drizzle-orm";

import { activityEvent } from "./schema/activity-event";
import { aiUsageEvent } from "./schema/ai-usage-event";
import { analysisModelUnit } from "./schema/analysis-model-unit";
import { analysisRun } from "./schema/analysis-run";
import { analysisRunItem } from "./schema/analysis-run-item";
import { approval } from "./schema/approval";
import { assistantConversation } from "./schema/assistant-conversation";
import { assistantMessage } from "./schema/assistant-message";
import { user } from "./schema/auth";
import { destinationAccount } from "./schema/destination-account";
import { draftRevision } from "./schema/draft-revision";
import { editorialSelection } from "./schema/editorial-selection";
import { filterResult } from "./schema/filter-result";
import { mediaAsset } from "./schema/media-asset";
import { mediaBrand } from "./schema/media-brand";
import { mediaBrandDestinationAccount } from "./schema/media-brand-destination-account";
import { mediaDerivation } from "./schema/media-derivation";
import { operation } from "./schema/operation";
import { operationAttempt } from "./schema/operation-attempt";
import { outboxEvent } from "./schema/outbox-event";
import { platformDraft } from "./schema/platform-draft";
import { promoIdea } from "./schema/promo-idea";
import { publishOperation } from "./schema/publish-operation";
import { savedCard } from "./schema/saved-card";
import { schedule } from "./schema/schedule";
import { sourceImport } from "./schema/source-import";
import { sourceItem } from "./schema/source-item";
import { sourceItemRevision } from "./schema/source-item-revision";

// Relations mirror the foreign keys the tables already declare, minus the
// workspace edge: workspace_id is the installation-identity filter every query
// carries, not an association anything traverses. A collection is declared
// where the parent owns the rows.

export const analysisRunRelations = relations(analysisRun, ({ one, many }) => ({
  operation: one(operation, {
    fields: [analysisRun.operationId],
    references: [operation.id],
  }),
  sourceImport: one(sourceImport, {
    fields: [analysisRun.sourceImportId],
    references: [sourceImport.id],
  }),
  semanticAttempt: one(operationAttempt, {
    fields: [analysisRun.semanticAttemptId],
    references: [operationAttempt.id],
  }),
  items: many(analysisRunItem),
  filterResults: many(filterResult),
  modelUnits: many(analysisModelUnit),
}));

export const analysisRunItemRelations = relations(
  analysisRunItem,
  ({ one }) => ({
    analysisRun: one(analysisRun, {
      fields: [analysisRunItem.analysisRunId],
      references: [analysisRun.id],
    }),
    sourceItem: one(sourceItem, {
      fields: [analysisRunItem.sourceItemId],
      references: [sourceItem.id],
    }),
    sourceItemRevision: one(sourceItemRevision, {
      fields: [analysisRunItem.sourceItemRevisionId],
      references: [sourceItemRevision.id],
    }),
    duplicateOfSourceItem: one(sourceItem, {
      fields: [analysisRunItem.duplicateOfSourceItemId],
      references: [sourceItem.id],
    }),
  }),
);

export const filterResultRelations = relations(filterResult, ({ one }) => ({
  analysisRun: one(analysisRun, {
    fields: [filterResult.analysisRunId],
    references: [analysisRun.id],
  }),
  sourceItem: one(sourceItem, {
    fields: [filterResult.sourceItemId],
    references: [sourceItem.id],
  }),
  mediaBrand: one(mediaBrand, {
    fields: [filterResult.mediaBrandId],
    references: [mediaBrand.id],
  }),
}));

export const analysisModelUnitRelations = relations(
  analysisModelUnit,
  ({ one, many }) => ({
    analysisRun: one(analysisRun, {
      fields: [analysisModelUnit.analysisRunId],
      references: [analysisRun.id],
    }),
    mediaBrand: one(mediaBrand, {
      fields: [analysisModelUnit.mediaBrandId],
      references: [mediaBrand.id],
    }),
    operationAttempt: one(operationAttempt, {
      fields: [analysisModelUnit.operationAttemptId],
      references: [operationAttempt.id],
    }),
    selections: many(editorialSelection),
    promoIdeas: many(promoIdea),
  }),
);

export const editorialSelectionRelations = relations(
  editorialSelection,
  ({ one }) => ({
    analysisModelUnit: one(analysisModelUnit, {
      fields: [editorialSelection.analysisModelUnitId],
      references: [analysisModelUnit.id],
    }),
    sourceItem: one(sourceItem, {
      fields: [editorialSelection.sourceItemId],
      references: [sourceItem.id],
    }),
  }),
);

export const promoIdeaRelations = relations(promoIdea, ({ one }) => ({
  analysisModelUnit: one(analysisModelUnit, {
    fields: [promoIdea.analysisModelUnitId],
    references: [analysisModelUnit.id],
  }),
}));

export const mediaBrandRelations = relations(mediaBrand, ({ many }) => ({
  destinationAccounts: many(mediaBrandDestinationAccount),
}));

export const destinationAccountRelations = relations(
  destinationAccount,
  ({ many }) => ({
    mediaBrands: many(mediaBrandDestinationAccount),
  }),
);

export const mediaBrandDestinationAccountRelations = relations(
  mediaBrandDestinationAccount,
  ({ one }) => ({
    mediaBrand: one(mediaBrand, {
      fields: [mediaBrandDestinationAccount.mediaBrandId],
      references: [mediaBrand.id],
    }),
    destinationAccount: one(destinationAccount, {
      fields: [mediaBrandDestinationAccount.destinationAccountId],
      references: [destinationAccount.id],
    }),
  }),
);

export const platformDraftRelations = relations(
  platformDraft,
  ({ one, many }) => ({
    mediaBrand: one(mediaBrand, {
      fields: [platformDraft.mediaBrandId],
      references: [mediaBrand.id],
    }),
    editorialSelection: one(editorialSelection, {
      fields: [platformDraft.editorialSelectionId],
      references: [editorialSelection.id],
    }),
    sourceItem: one(sourceItem, {
      fields: [platformDraft.sourceItemId],
      references: [sourceItem.id],
    }),
    revisions: many(draftRevision),
  }),
);

export const draftRevisionRelations = relations(draftRevision, ({ one }) => ({
  platformDraft: one(platformDraft, {
    fields: [draftRevision.platformDraftId],
    references: [platformDraft.id],
  }),
  mediaAsset: one(mediaAsset, {
    fields: [draftRevision.mediaAssetId],
    references: [mediaAsset.id],
  }),
  author: one(user, {
    fields: [draftRevision.authoredBy],
    references: [user.id],
  }),
}));

export const savedCardRelations = relations(savedCard, ({ one }) => ({
  platformDraft: one(platformDraft, {
    fields: [savedCard.platformDraftId],
    references: [platformDraft.id],
  }),
  contentCard: one(platformDraft, {
    fields: [savedCard.contentCardId],
    references: [platformDraft.id],
  }),
  savedBy: one(user, {
    fields: [savedCard.savedBy],
    references: [user.id],
  }),
}));

export const approvalRelations = relations(approval, ({ one }) => ({
  draftRevision: one(draftRevision, {
    fields: [approval.draftRevisionId],
    references: [draftRevision.id],
  }),
  decidedBy: one(user, {
    fields: [approval.decidedBy],
    references: [user.id],
  }),
}));

export const mediaAssetRelations = relations(mediaAsset, ({ many }) => ({
  derivations: many(mediaDerivation),
}));

export const mediaDerivationRelations = relations(
  mediaDerivation,
  ({ one }) => ({
    mediaAsset: one(mediaAsset, {
      fields: [mediaDerivation.mediaAssetId],
      references: [mediaAsset.id],
    }),
  }),
);

export const operationRelations = relations(operation, ({ one, many }) => ({
  actor: one(user, {
    fields: [operation.actor],
    references: [user.id],
  }),
  attempts: many(operationAttempt),
  usageEvents: many(aiUsageEvent),
  publish: one(publishOperation),
  sourceImport: one(sourceImport),
  outboxEvents: many(outboxEvent),
}));

export const sourceImportRelations = relations(sourceImport, ({ one }) => ({
  operation: one(operation, {
    fields: [sourceImport.operationId],
    references: [operation.id],
  }),
}));

export const operationAttemptRelations = relations(
  operationAttempt,
  ({ one, many }) => ({
    operation: one(operation, {
      fields: [operationAttempt.operationId],
      references: [operation.id],
    }),
    usageEvents: many(aiUsageEvent),
  }),
);

export const aiUsageEventRelations = relations(aiUsageEvent, ({ one }) => ({
  operation: one(operation, {
    fields: [aiUsageEvent.operationId],
    references: [operation.id],
  }),
  operationAttempt: one(operationAttempt, {
    fields: [aiUsageEvent.operationAttemptId],
    references: [operationAttempt.id],
  }),
}));

export const publishOperationRelations = relations(
  publishOperation,
  ({ one }) => ({
    operation: one(operation, {
      fields: [publishOperation.operationId],
      references: [operation.id],
    }),
    draftRevision: one(draftRevision, {
      fields: [publishOperation.draftRevisionId],
      references: [draftRevision.id],
    }),
    schedule: one(schedule, {
      fields: [publishOperation.scheduleId],
      references: [schedule.id],
    }),
  }),
);

export const scheduleRelations = relations(schedule, ({ one }) => ({
  draftRevision: one(draftRevision, {
    fields: [schedule.draftRevisionId],
    references: [draftRevision.id],
  }),
}));

export const outboxEventRelations = relations(outboxEvent, ({ one }) => ({
  operation: one(operation, {
    fields: [outboxEvent.operationId],
    references: [operation.id],
  }),
}));

export const activityEventRelations = relations(activityEvent, ({ one }) => ({
  actor: one(user, {
    fields: [activityEvent.actor],
    references: [user.id],
  }),
  platformDraft: one(platformDraft, {
    fields: [activityEvent.platformDraftId],
    references: [platformDraft.id],
  }),
  operation: one(operation, {
    fields: [activityEvent.operationId],
    references: [operation.id],
  }),
}));

export const assistantConversationRelations = relations(
  assistantConversation,
  ({ one, many }) => ({
    user: one(user, {
      fields: [assistantConversation.userId],
      references: [user.id],
    }),
    messages: many(assistantMessage),
  }),
);

export const assistantMessageRelations = relations(
  assistantMessage,
  ({ one }) => ({
    conversation: one(assistantConversation, {
      fields: [assistantMessage.conversationId],
      references: [assistantConversation.id],
    }),
  }),
);
