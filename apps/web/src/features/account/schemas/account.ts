import type { ActivityEventType, Platform } from "@rz-chain-reporter/contracts";

import type { ACTIVITY_RECORD_KINDS } from "../constants";

export type AccountSummaryBrand = {
  key: string;
  name: string;
  generatedDrafts: number;
  scheduled: number;
  saved: number;
};

export type AccountSummary = {
  generatedDrafts: number;
  scheduled: number;
  saved: number;
  brands: AccountSummaryBrand[];
};

export type ActivityHistoryRow = {
  id: string;
  eventType: ActivityEventType;
  occurredAt: Date;
  platformDraftId: string | null;
  brandKey: string | null;
  brandName: string | null;
  platform: Platform | null;
  headline: string | null;
};

export type ActivityRecordKind = (typeof ACTIVITY_RECORD_KINDS)[number];

export type ActivityLedgerRow = {
  id: string;
  eventType: ActivityEventType;
  occurredAt: Date;
  actorName: string | null;
  actorEmail: string | null;
  recordKind: ActivityRecordKind;
  recordId: string;
};
