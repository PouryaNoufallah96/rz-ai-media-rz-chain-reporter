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
import { copyGeneration } from "./schema/copy-generation";
import { copyGenerationUnit } from "./schema/copy-generation-unit";
import { copyVariant } from "./schema/copy-variant";
import { copyVariantLocalization } from "./schema/copy-variant-localization";
import { copyVariantLocalizationRequest } from "./schema/copy-variant-localization-request";
import { destinationAccount } from "./schema/destination-account";
import { draftRevision } from "./schema/draft-revision";
import { draftRevisionCommandReceipt } from "./schema/draft-revision-command-receipt";
import { editorialPresentationLocalization } from "./schema/editorial-presentation-localization";
import { editorialPresentationLocalizationRequest } from "./schema/editorial-presentation-localization-request";
import { editorialSelection } from "./schema/editorial-selection";
import { filterResult } from "./schema/filter-result";
import { imageBrief } from "./schema/image-brief";
import { imageGeneration } from "./schema/image-generation";
import { imageVarietyMemory } from "./schema/image-variety-memory";
import { mediaAsset } from "./schema/media-asset";
import { mediaBrand } from "./schema/media-brand";
import { mediaBrandDestinationAccount } from "./schema/media-brand-destination-account";
import { mediaDerivation } from "./schema/media-derivation";
import { operation } from "./schema/operation";
import { operationAttempt } from "./schema/operation-attempt";
import { outboxEvent } from "./schema/outbox-event";
import { platformDraft } from "./schema/platform-draft";
import { promoIdea } from "./schema/promo-idea";
import { publication } from "./schema/publication";
import { publicationReconciliation } from "./schema/publication-reconciliation";
import { publishCheckpoint } from "./schema/publish-checkpoint";
import { publishOperation } from "./schema/publish-operation";
import { publishingMediaGrant } from "./schema/publishing-media-grant";
import { savedCard } from "./schema/saved-card";
import { schedule } from "./schema/schedule";
import { sourceImport } from "./schema/source-import";
import { sourceItem } from "./schema/source-item";
import { sourceItemEnrichment } from "./schema/source-item-enrichment";
import { sourceItemRevision } from "./schema/source-item-revision";

// Relations mirror foreign keys except `workspace_id`, which scopes installation
// queries but is not a traversable association. Parents declare owned collections.

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

export const filterResultRelations = relations(
  filterResult,
  ({ one, many }) => ({
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
    presentationTranslationRequests: many(
      editorialPresentationLocalizationRequest,
    ),
  }),
);

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
  ({ one, many }) => ({
    analysisModelUnit: one(analysisModelUnit, {
      fields: [editorialSelection.analysisModelUnitId],
      references: [analysisModelUnit.id],
    }),
    sourceItem: one(sourceItem, {
      fields: [editorialSelection.sourceItemId],
      references: [sourceItem.id],
    }),
    presentationLocalizations: many(editorialPresentationLocalization),
    presentationTranslationRequests: many(
      editorialPresentationLocalizationRequest,
    ),
  }),
);

export const promoIdeaRelations = relations(promoIdea, ({ one, many }) => ({
  analysisModelUnit: one(analysisModelUnit, {
    fields: [promoIdea.analysisModelUnitId],
    references: [analysisModelUnit.id],
  }),
  presentationLocalizations: many(editorialPresentationLocalization),
  presentationTranslationRequests: many(
    editorialPresentationLocalizationRequest,
  ),
}));

export const sourceItemRevisionRelations = relations(
  sourceItemRevision,
  ({ many }) => ({
    presentationLocalizations: many(editorialPresentationLocalization),
  }),
);

export const editorialPresentationLocalizationRelations = relations(
  editorialPresentationLocalization,
  ({ one }) => ({
    sourceItemRevision: one(sourceItemRevision, {
      fields: [editorialPresentationLocalization.sourceItemRevisionId],
      references: [sourceItemRevision.id],
    }),
    editorialSelection: one(editorialSelection, {
      fields: [editorialPresentationLocalization.editorialSelectionId],
      references: [editorialSelection.id],
    }),
    promoIdea: one(promoIdea, {
      fields: [editorialPresentationLocalization.promoIdeaId],
      references: [promoIdea.id],
    }),
    operationAttempt: one(operationAttempt, {
      fields: [editorialPresentationLocalization.operationAttemptId],
      references: [operationAttempt.id],
    }),
  }),
);

export const editorialPresentationLocalizationRequestRelations = relations(
  editorialPresentationLocalizationRequest,
  ({ one }) => ({
    operation: one(operation, {
      fields: [editorialPresentationLocalizationRequest.operationId],
      references: [operation.id],
    }),
    editorialSelection: one(editorialSelection, {
      fields: [editorialPresentationLocalizationRequest.editorialSelectionId],
      references: [editorialSelection.id],
    }),
    telegramFilterResult: one(filterResult, {
      fields: [editorialPresentationLocalizationRequest.telegramFilterResultId],
      references: [filterResult.id],
    }),
    promoIdea: one(promoIdea, {
      fields: [editorialPresentationLocalizationRequest.promoIdeaId],
      references: [promoIdea.id],
    }),
  }),
);

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
    telegramFilterResult: one(filterResult, {
      fields: [platformDraft.telegramFilterResultId],
      references: [filterResult.id],
    }),
    promoIdea: one(promoIdea, {
      fields: [platformDraft.promoIdeaId],
      references: [promoIdea.id],
    }),
    copyGenerations: many(copyGeneration),
    revisions: many(draftRevision, { relationName: "draftHistory" }),
    activeRevision: one(draftRevision, {
      fields: [
        platformDraft.workspaceId,
        platformDraft.id,
        platformDraft.activeRevisionId,
      ],
      references: [
        draftRevision.workspaceId,
        draftRevision.platformDraftId,
        draftRevision.id,
      ],
      relationName: "activeDraftRevision",
    }),
  }),
);

export const draftRevisionRelations = relations(
  draftRevision,
  ({ one, many }) => ({
    platformDraft: one(platformDraft, {
      fields: [draftRevision.platformDraftId],
      references: [platformDraft.id],
      relationName: "draftHistory",
    }),
    originatingCopyVariant: one(copyVariant, {
      fields: [draftRevision.originatingCopyVariantId],
      references: [copyVariant.id],
    }),
    selectedFinalMediaAsset: one(mediaAsset, {
      fields: [draftRevision.selectedFinalMediaAssetId],
      references: [mediaAsset.id],
    }),
    author: one(user, {
      fields: [draftRevision.authoredBy],
      references: [user.id],
    }),
    commandReceipts: many(draftRevisionCommandReceipt),
    imageBriefs: many(imageBrief),
    imageGenerations: many(imageGeneration),
  }),
);

export const copyGenerationRelations = relations(
  copyGeneration,
  ({ one, many }) => ({
    operation: one(operation, {
      fields: [copyGeneration.operationId],
      references: [operation.id],
    }),
    platformDraft: one(platformDraft, {
      fields: [copyGeneration.platformDraftId],
      references: [platformDraft.id],
    }),
    pageFetchOperationAttempt: one(operationAttempt, {
      fields: [copyGeneration.pageFetchOperationAttemptId],
      references: [operationAttempt.id],
    }),
    sourceItemRevision: one(sourceItemRevision, {
      fields: [copyGeneration.sourceItemRevisionId],
      references: [sourceItemRevision.id],
    }),
    sourceItemEnrichment: one(sourceItemEnrichment, {
      fields: [copyGeneration.sourceItemEnrichmentId],
      references: [sourceItemEnrichment.id],
    }),
    units: many(copyGenerationUnit),
  }),
);

export const copyGenerationUnitRelations = relations(
  copyGenerationUnit,
  ({ one }) => ({
    generation: one(copyGeneration, {
      fields: [copyGenerationUnit.copyGenerationId],
      references: [copyGeneration.operationId],
    }),
    operationAttempt: one(operationAttempt, {
      fields: [copyGenerationUnit.operationAttemptId],
      references: [operationAttempt.id],
    }),
    variant: one(copyVariant),
  }),
);

export const copyVariantRelations = relations(copyVariant, ({ one, many }) => ({
  unit: one(copyGenerationUnit, {
    fields: [copyVariant.copyGenerationUnitId],
    references: [copyGenerationUnit.id],
  }),
  revisions: many(draftRevision),
  localizations: many(copyVariantLocalization),
  translationRequests: many(copyVariantLocalizationRequest),
}));

export const copyVariantLocalizationRelations = relations(
  copyVariantLocalization,
  ({ one }) => ({
    copyVariant: one(copyVariant, {
      fields: [copyVariantLocalization.copyVariantId],
      references: [copyVariant.id],
    }),
    operationAttempt: one(operationAttempt, {
      fields: [copyVariantLocalization.operationAttemptId],
      references: [operationAttempt.id],
    }),
  }),
);

export const copyVariantLocalizationRequestRelations = relations(
  copyVariantLocalizationRequest,
  ({ one }) => ({
    operation: one(operation, {
      fields: [copyVariantLocalizationRequest.operationId],
      references: [operation.id],
    }),
    copyVariant: one(copyVariant, {
      fields: [copyVariantLocalizationRequest.copyVariantId],
      references: [copyVariant.id],
    }),
  }),
);

export const draftRevisionCommandReceiptRelations = relations(
  draftRevisionCommandReceipt,
  ({ one }) => ({
    actor: one(user, {
      fields: [draftRevisionCommandReceipt.actorId],
      references: [user.id],
    }),
    platformDraft: one(platformDraft, {
      fields: [draftRevisionCommandReceipt.platformDraftId],
      references: [platformDraft.id],
    }),
    resultingDraftRevision: one(draftRevision, {
      fields: [draftRevisionCommandReceipt.resultingDraftRevisionId],
      references: [draftRevision.id],
    }),
  }),
);

export const savedCardRelations = relations(savedCard, ({ one }) => ({
  platformDraft: one(platformDraft, {
    fields: [savedCard.platformDraftId],
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
  approvedBy: one(user, {
    fields: [approval.approvedBy],
    references: [user.id],
  }),
  selectedFinalMediaAsset: one(mediaAsset, {
    fields: [approval.selectedFinalMediaAssetId],
    references: [mediaAsset.id],
  }),
}));

export const publicationRelations = relations(publication, ({ one, many }) => ({
  approval: one(approval, {
    fields: [publication.approvalId],
    references: [approval.id],
  }),
  draftRevision: one(draftRevision, {
    fields: [publication.draftRevisionId],
    references: [draftRevision.id],
  }),
  selectedFinalMediaAsset: one(mediaAsset, {
    fields: [publication.selectedFinalMediaAssetId],
    references: [mediaAsset.id],
  }),
  operations: many(publishOperation),
  schedules: many(schedule),
  checkpoints: many(publishCheckpoint),
  reconciliations: many(publicationReconciliation),
  mediaGrants: many(publishingMediaGrant),
}));

export const mediaAssetRelations = relations(mediaAsset, ({ many }) => ({
  sourceDerivations: many(mediaDerivation, {
    relationName: "mediaDerivationSource",
  }),
  derivedDerivations: many(mediaDerivation, {
    relationName: "mediaDerivationDerived",
  }),
  referenceImageGenerations: many(imageGeneration, {
    relationName: "imageGenerationReference",
  }),
  originalImageGenerations: many(imageGeneration, {
    relationName: "imageGenerationOriginal",
  }),
  finalImageGenerations: many(imageGeneration, {
    relationName: "imageGenerationFinal",
  }),
}));

export const mediaDerivationRelations = relations(
  mediaDerivation,
  ({ one }) => ({
    sourceMediaAsset: one(mediaAsset, {
      fields: [mediaDerivation.sourceMediaAssetId],
      references: [mediaAsset.id],
      relationName: "mediaDerivationSource",
    }),
    derivedMediaAsset: one(mediaAsset, {
      fields: [mediaDerivation.derivedMediaAssetId],
      references: [mediaAsset.id],
      relationName: "mediaDerivationDerived",
    }),
  }),
);

export const imageBriefRelations = relations(imageBrief, ({ one, many }) => ({
  draftRevision: one(draftRevision, {
    fields: [imageBrief.draftRevisionId],
    references: [draftRevision.id],
  }),
  repeatedMemory: one(imageVarietyMemory, {
    fields: [imageBrief.repeatedImageVarietyMemoryId],
    references: [imageVarietyMemory.id],
  }),
  templateSelectionOperationAttempt: one(operationAttempt, {
    fields: [imageBrief.templateSelectionOperationAttemptId],
    references: [operationAttempt.id],
  }),
  creativeBriefOperationAttempt: one(operationAttempt, {
    fields: [imageBrief.creativeBriefOperationAttemptId],
    references: [operationAttempt.id],
  }),
  rssSourceItemEnrichment: one(sourceItemEnrichment, {
    fields: [imageBrief.rssSourceItemEnrichmentId],
    references: [sourceItemEnrichment.id],
  }),
  telegramSourceItemRevision: one(sourceItemRevision, {
    fields: [imageBrief.telegramSourceItemRevisionId],
    references: [sourceItemRevision.id],
  }),
  promoIdea: one(promoIdea, {
    fields: [imageBrief.promoIdeaId],
    references: [promoIdea.id],
  }),
  imageGenerations: many(imageGeneration),
}));

export const imageGenerationRelations = relations(
  imageGeneration,
  ({ one }) => ({
    operation: one(operation, {
      fields: [imageGeneration.operationId],
      references: [operation.id],
    }),
    draftRevision: one(draftRevision, {
      fields: [imageGeneration.draftRevisionId],
      references: [draftRevision.id],
    }),
    imageBrief: one(imageBrief, {
      fields: [imageGeneration.imageBriefId],
      references: [imageBrief.id],
    }),
    referenceMediaAsset: one(mediaAsset, {
      fields: [imageGeneration.referenceMediaAssetId],
      references: [mediaAsset.id],
      relationName: "imageGenerationReference",
    }),
    providerGenerationOperationAttempt: one(operationAttempt, {
      fields: [imageGeneration.providerGenerationOperationAttemptId],
      references: [operationAttempt.id],
    }),
    providerOriginalMediaAsset: one(mediaAsset, {
      fields: [imageGeneration.providerOriginalMediaAssetId],
      references: [mediaAsset.id],
      relationName: "imageGenerationOriginal",
    }),
    finalMediaAsset: one(mediaAsset, {
      fields: [imageGeneration.finalMediaAssetId],
      references: [mediaAsset.id],
      relationName: "imageGenerationFinal",
    }),
    varietyMemory: one(imageVarietyMemory),
  }),
);

export const imageVarietyMemoryRelations = relations(
  imageVarietyMemory,
  ({ one }) => ({
    mediaBrand: one(mediaBrand, {
      fields: [imageVarietyMemory.mediaBrandId],
      references: [mediaBrand.id],
    }),
    imageGeneration: one(imageGeneration, {
      fields: [imageVarietyMemory.imageGenerationId],
      references: [imageGeneration.operationId],
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
  copyGeneration: one(copyGeneration),
  imageGeneration: one(imageGeneration),
  publish: one(publishOperation),
  sourceImport: one(sourceImport),
  presentationTranslationRequest: one(editorialPresentationLocalizationRequest),
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
    presentationLocalizations: many(editorialPresentationLocalization),
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
    fields: [activityEvent.actorId],
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
