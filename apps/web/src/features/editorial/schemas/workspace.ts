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
  ModelUnitStatus,
  OperationLifecycle,
  Platform,
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
  analysisRunWindowHoursSchema,
  platformSchema,
  telegramOrderingModeSchema,
} from "@rz-chain-reporter/contracts";
import type { AnalysisRunProgress } from "@rz-chain-reporter/db/repositories/analysis-run";
import { createLoader, parseAsString, type SearchParams } from "nuqs/server";
import { z } from "zod";

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

// Transport shape only, so openapi.json stays customer-independent: the router
// re-parses it with `runConfigurationSchema(bounds)`, which owns every bound.
const startAnalysisRunNewsSchema = z.strictObject({
  kind: z.literal("news"),
  brands: z.array(z.string()),
  models: z.array(z.string()),
  platforms: z.array(platformSchema),
  sourceIds: z.array(z.uuid()),
  windowHours: analysisRunWindowHoursSchema,
  enrichmentEnabled: z.boolean(),
  telegramOnly: z.boolean(),
  orderingMode: telegramOrderingModeSchema,
  topN: z.int(),
  topics: z.array(z.string()),
});

const startAnalysisRunPromoSchema = z.strictObject({
  kind: z.literal("promo"),
  models: z.array(z.string()),
  promo: z.strictObject({
    brands: z.array(z.string()),
    prompts: z.record(z.string(), z.string()),
  }),
});

export const startAnalysisRunInputSchema = z.discriminatedUnion("kind", [
  startAnalysisRunNewsSchema,
  startAnalysisRunPromoSchema,
]);

export const analysisRunIdSchema = z.uuid();

export const cancelAnalysisRunInputSchema = z.object({
  analysisRunId: analysisRunIdSchema,
});

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
};

export type PromoIdeaCard = {
  id: string;
  rank: number;
  title: string;
  description: string;
  angle: string;
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
  models: readonly { key: string; name: string }[];
  brands: readonly { key: string; name: string; promoEnabled: boolean }[];
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
