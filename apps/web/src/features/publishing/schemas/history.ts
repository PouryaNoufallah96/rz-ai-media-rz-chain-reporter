import type {
  ContentLocale,
  Platform,
  PublicationLifecycle,
  PublishCheckpointKind,
  ReconciliationAuthority,
  ReconciliationDecision,
  ScheduleStatus,
  SettlementActivityStatus,
} from "@rz-chain-reporter/contracts";
import {
  createLoader,
  parseAsString,
  parseAsStringLiteral,
  type SearchParams,
} from "nuqs/server";
import { z } from "zod";

import { keysetCursorParam } from "@/features/shared/lib/keyset-cursor";

import { PUBLISHING_VIEWS } from "../constants";

export const SAVED_STATES = ["active", "discarded", "all"] as const;

export const savedSearchParsers = {
  state: parseAsStringLiteral(SAVED_STATES).withDefault("active"),
  cursor: parseAsString,
};
export const publishingSearchParsers = {
  view: parseAsStringLiteral(PUBLISHING_VIEWS).withDefault("scheduled"),
  cursor: parseAsString,
};
export const loadSavedSearchParams = createLoader(savedSearchParsers);
export const loadPublishingSearchParams = createLoader(publishingSearchParsers);
export type PublishingSearchParams = Promise<SearchParams>;

const savedQuerySchema = z.strictObject({
  state: z.enum(SAVED_STATES),
  cursor: keysetCursorParam,
});
const publishingQuerySchema = z.strictObject({
  view: z.enum(PUBLISHING_VIEWS),
  cursor: keysetCursorParam,
});
export type SavedQuery = z.infer<typeof savedQuerySchema>;
export type PublishingQuery = z.infer<typeof publishingQuerySchema>;

export function normalizeSavedQuery(
  input: Awaited<ReturnType<typeof loadSavedSearchParams>>,
) {
  return savedQuerySchema.parse(input);
}
export function normalizePublishingQuery(
  input: Awaited<ReturnType<typeof loadPublishingSearchParams>>,
) {
  return publishingQuerySchema.parse(input);
}

export type SavedHistoryRow = {
  id: string;
  analysisRunId: string;
  platformDraftId: string;
  savedAt: Date;
  discardedAt: Date | null;
  version: number;
  brandName: string;
  platform: Platform;
  originTitle: string;
  revisionNumber: number | null;
  headline: string | null;
  body: string | null;
  contentLocale: ContentLocale | null;
  hasImage: boolean;
  approved: boolean;
};

export type PublishingHistoryRow = {
  id: string;
  platformDraftId: string;
  occurredAt: Date;
  brandName: string;
  headline: string;
  body: string;
  contentLocale: ContentLocale;
  hasImage: boolean;
  destinationAccountId: string;
  destinationKey: string;
  destinationLabel: string;
  eligibleDestinations: Array<{
    id: string;
    key: string;
    label: string;
  }>;
  platform: Platform;
  revisionNumber: number;
  lifecycle: PublicationLifecycle | ScheduleStatus;
  version: number;
  publicationVersion: number;
  scheduleId: string | null;
  publicationId: string;
  operationId: string | null;
  unresolvedAttemptId: string | null;
  providerResultId: string | null;
  evidenceCheckpointId: string | null;
  evidenceCheckpointKind: PublishCheckpointKind | null;
  reconciliationDecision: ReconciliationDecision | null;
  reconciliationAuthority: ReconciliationAuthority | null;
  reconciledAt: Date | null;
  activityStatus: SettlementActivityStatus;
  timezone: string | null;
};
