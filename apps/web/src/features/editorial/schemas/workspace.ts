import type {
  AnalysisRunKind,
  AnalysisRunWindowHours,
  ContentLocale,
  DuplicateMethod,
  ErrorCode,
  FilterDisposition,
  FilteringReason,
  InvocationKey,
  ModelBackend,
  ModelOption,
  ModelUnitStatus,
  OperationLifecycle,
  Platform,
  RunCardOriginReference,
  RunConfiguration,
  RunConfigurationBounds,
  SemanticDegradedReason,
  SemanticParticipation,
  SemanticStageStatus,
  SourceFetchOutcome,
  SourceFetchReason,
  SourceImportBinding,
  SourceOrigin,
  TelegramOrderingMode,
} from "@rz-chain-reporter/contracts";
import {
  cardOriginReferenceSchema,
  contentLocaleSchema,
  dispatchStateSchema,
  operationLifecycleSchema,
} from "@rz-chain-reporter/contracts";
import type { AnalysisRunProgress } from "@rz-chain-reporter/db/repositories/analysis-run";
import { createLoader, parseAsString, type SearchParams } from "nuqs/server";
import { z } from "zod";
import type { BrandLogo } from "@/components/common/brand-mark";

export const workspaceSearchParsers = {
  draft: parseAsString,
  run: parseAsString,
};

export const loadWorkspaceSearchParams = createLoader(workspaceSearchParsers);

export type WorkspaceSearchParams = Promise<SearchParams>;

const workspaceQuerySchema = z.object({
  draft: z.uuid().nullable().catch(null),
  run: z.uuid().nullable().catch(null),
});

type WorkspaceQuery = z.infer<typeof workspaceQuerySchema>;

export function normalizeWorkspaceQuery(
  input: Awaited<ReturnType<typeof loadWorkspaceSearchParams>>,
): WorkspaceQuery {
  return workspaceQuerySchema.parse(input);
}

export const analysisRunIdSchema = z.uuid();

export const cancelAnalysisRunInputSchema = z.object({
  analysisRunId: analysisRunIdSchema,
});

export const startPresentationTranslationInputSchema = z.strictObject({
  origin: cardOriginReferenceSchema.transform<RunCardOriginReference>(
    (origin, context) => {
      if (origin.kind === "market_analysis_handoff") {
        context.addIssue({
          code: "custom",
          message: "MARKET_PRESENTATION_TRANSLATION_NOT_APPLICABLE",
        });
        return z.NEVER;
      }
      return origin;
    },
  ),
  presentationLocale: contentLocaleSchema,
  idempotencyKey: z.uuid({ error: "IDEMPOTENCY_KEY_REQUIRED" }),
});

export const translationCommandResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("already_available") }),
  z.strictObject({
    status: z.enum(["created", "replayed"]),
    operationId: z.uuid(),
    lifecycle: operationLifecycleSchema,
  }),
]);

export const presentationTranslationCommandResultSchema =
  translationCommandResultSchema;

export const translationStatusSchema = z.strictObject({
  dispatchState: dispatchStateSchema,
  lifecycle: operationLifecycleSchema,
  operationId: z.uuid(),
});

export const presentationTranslationStatusSchema = translationStatusSchema;

export type TranslationStatus = z.infer<typeof translationStatusSchema>;
export type PresentationTranslationStatus = TranslationStatus;

export const startAnalysisRunResultSchema = z.object({
  operationId: z.uuid(),
  analysisRunId: z.uuid(),
});

type RunProvenance = {
  scoringVersion: string | null;
  semanticStatus: SemanticStageStatus;
  semanticReason: SemanticDegradedReason | null;
  semanticModel: string | null;
  semanticBackend: ModelBackend | null;
  semanticDimension: number | null;
  semanticNormalizationVersion: string | null;
  semanticProjectionVersion: string | null;
  semanticTopicCount: number | null;
  semanticAnchorCount: number | null;
};

type RunProgressStage =
  | "queuedForDispatch"
  | "waitingForWorker"
  | "preparing"
  | "acquiring"
  | "filtering"
  | "models"
  | "settling"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export type RunExecution = {
  stage: RunProgressStage;
  dispatch: "pending" | "dispatched" | "exhausted";
  elapsedFrom: Date;
  elapsedTo: Date | null;
  lastProgressAt: Date;
};

export type RunHead = {
  id: string;
  operationId: string;
  kind: AnalysisRunKind;
  lifecycle: OperationLifecycle;
  failureCode: ErrorCode | null;
  configuration: RunConfiguration;
  templateFingerprint: string;
  templateChanged: boolean;
  sourceImportId: string | null;
  sourceImportBinding: SourceImportBinding | null;
  startedAt: Date;
  completedAt: Date | null;
  cancelRequestedAt: Date | null;
  cancelledAt: Date | null;
  execution: RunExecution;
  provenance: RunProvenance;
  progress: AnalysisRunProgress;
  telegramAcquisition: TelegramAcquisition;
  topicTranslationFallback: boolean;
};

export type RunOption = {
  id: string;
  kind: AnalysisRunKind;
  lifecycle: OperationLifecycle;
  startedAt: Date;
  templateFingerprint: string;
};

export type SelectionCard = {
  id: string;
  rank: number;
  sourceItemId: string;
  suggestedPlatform: Platform;
  reasoning: string | null;
  suitabilityScore: number | null;
  impactScore: number | null;
  viralityScore: number | null;
  confidenceScore: number | null;
  title: string;
  summary: string | null;
  canonicalUrl: string;
  contentLocale: ContentLocale;
  sourceName: string;
  sourceOrigin: SourceOrigin;
  publishedAt: Date | null;
  presentationReady: boolean;
  presentationTranslation: PresentationTranslationStatus | null;
};

export type PromoIdeaCard = {
  id: string;
  rank: number;
  title: string;
  description: string;
  angle: string;
  presentationReady: boolean;
  presentationTranslation: PresentationTranslationStatus | null;
};

export type ModelLane = {
  unitId: string | null;
  mediaBrandId: string;
  brandKey: string;
  brandName: string;
  modelOptionKey: string;
  taskKey: string | null;
  status: ModelUnitStatus | null;
  failureCode: ErrorCode | null;
  invocationKey: InvocationKey | null;
  selections: SelectionCard[];
  promoIdeas: PromoIdeaCard[];
};

export type TelegramCard = {
  telegramFilterResultId: string;
  sourceItemId: string;
  rankPosition: number | null;
  disposition: FilterDisposition;
  reason: FilteringReason | null;
  duplicateMethod: DuplicateMethod | null;
  duplicateOfSourceItemId: string | null;
  duplicateSimilarityBp: number | null;
  semanticParticipation: SemanticParticipation | null;
  title: string;
  summary: string | null;
  canonicalUrl: string;
  contentLocale: ContentLocale;
  channelHandle: string;
  sourceName: string;
  publishedAt: Date | null;
  views: number | null;
  orderingMode: TelegramOrderingMode;
  sourceRank: number | null;
  keywordScore: number | null;
  duplicateRssCount: number;
  presentationReady: boolean;
  presentationTranslation: PresentationTranslationStatus | null;
};

type TelegramSourceFailure = {
  channelHandle: string;
  code: SourceFetchOutcome | SourceFetchReason;
};

export type TelegramAcquisition = {
  acquiredChannels: number;
  failures: TelegramSourceFailure[];
  totalChannels: number;
};

export type TelegramLane = {
  mediaBrandId: string;
  brandKey: string;
  brandName: string;
  cards: TelegramCard[];
};

export type EditorialWorkspace = {
  head: RunHead | null;
  modelLanes: ModelLane[];
  telegramLanes: TelegramLane[];
  query: WorkspaceQuery;
  readAt: Date;
};

export type PreviousRun = {
  id: string;
  dropped: string[];
  configuration: RunConfiguration;
};

export type RunOptions = {
  models: readonly ModelOption[];
  brands: readonly {
    key: string;
    name: string;
    logo: BrandLogo | null;
    promoEnabled: boolean;
  }[];
  platforms: readonly Platform[];
  defaults: {
    brands: readonly string[];
    models: readonly string[];
    platforms: readonly Platform[];
    windowHours: AnalysisRunWindowHours;
    enrichment: boolean;
    sourceKeys?: readonly string[];
    orderingMode: TelegramOrderingMode;
    topN: number;
  };
  bounds: RunConfigurationBounds;
  windowHours: readonly AnalysisRunWindowHours[];
  runs: RunOption[];
  recentTopics: string[];
  previousRun: PreviousRun | null;
};
