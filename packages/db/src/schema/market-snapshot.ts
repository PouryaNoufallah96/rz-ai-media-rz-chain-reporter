import type {
  ErrorCode,
  MarketProviderMapping,
  NormalizedMarketRequest,
} from "@rz-chain-reporter/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  marketPeriod,
  marketProvider,
  marketScale,
  marketSeriesRole,
  marketSnapshotSeriesOutcome,
  marketSnapshotStatus,
} from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { marketAnalysis, marketInstrument } from "./market-analysis";
import { operation } from "./operation";
import { workspace } from "./workspace";

export type MarketPricePoint = readonly [timestamp: string, price: string];

export const marketSnapshot = pgTable(
  "market_snapshot",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    marketAnalysisId: uuid("market_analysis_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    verificationIntentId: uuid("verification_intent_id").notNull(),
    verificationIntentVersion: integer("verification_intent_version").notNull(),
    normalizedRequest: jsonb("normalized_request")
      .$type<NormalizedMarketRequest>()
      .notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    templateFingerprint: text("template_fingerprint").notNull(),
    period: marketPeriod("period").notNull(),
    scale: marketScale("scale").notNull(),
    effectiveWindowStart: timestamp("effective_window_start", {
      withTimezone: true,
    }),
    effectiveWindowEnd: timestamp("effective_window_end", {
      withTimezone: true,
    }),
    fetchCompletedAt: timestamp("fetch_completed_at", {
      withTimezone: true,
    }).notNull(),
    status: marketSnapshotStatus("status").notNull(),
    warnings: jsonb("warnings").$type<readonly string[]>().notNull(),
    aggregateMetadata: jsonb("aggregate_metadata"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_market_snapshot_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_snapshot_market_analysis_id",
      columns: [t.marketAnalysisId],
      foreignColumns: [marketAnalysis.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_snapshot_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    unique("uq_market_snapshot_operation_id").on(t.operationId),
    unique("uq_market_snapshot_workspace_analysis_id").on(
      t.workspaceId,
      t.marketAnalysisId,
      t.id,
    ),
    index("ix_market_snapshot_workspace_analysis_created").on(
      t.workspaceId,
      t.marketAnalysisId,
      t.createdAt,
    ),
    check(
      "ck_market_snapshot_intent_version_positive",
      sql`${t.verificationIntentVersion} > 0`,
    ),
    check(
      "ck_market_snapshot_effective_window_order",
      sql`${t.effectiveWindowStart} is null or ${t.effectiveWindowEnd} is null or ${t.effectiveWindowStart} <= ${t.effectiveWindowEnd}`,
    ),
    check(
      "ck_market_snapshot_warnings_bounded",
      sql`jsonb_typeof(${t.warnings}) = 'array' and jsonb_array_length(${t.warnings}) <= 32`,
    ),
  ],
);

export const marketSnapshotSeries = pgTable(
  "market_snapshot_series",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    marketSnapshotId: uuid("market_snapshot_id").notNull(),
    position: integer("position").notNull(),
    descriptorIdentity: text("descriptor_identity").notNull(),
    role: marketSeriesRole("role").notNull(),
    controlledInstrumentId: uuid("controlled_instrument_id"),
    provider: marketProvider("provider"),
    mapping: jsonb("mapping").$type<MarketProviderMapping>(),
    providerReference: text("provider_reference"),
    attributionIdentity: text("attribution_identity"),
    points: jsonb("points").$type<readonly MarketPricePoint[]>(),
    coverageStart: timestamp("coverage_start", { withTimezone: true }),
    coverageEnd: timestamp("coverage_end", { withTimezone: true }),
    startPrice: numeric("start_price"),
    endPrice: numeric("end_price"),
    changePercent: numeric("change_percent"),
    outcome: marketSnapshotSeriesOutcome("outcome").notNull(),
    failureCode: text("failure_code").$type<ErrorCode>(),
    attemptedMappings:
      jsonb("attempted_mappings").$type<readonly MarketProviderMapping[]>(),
    retryClassification: text("retry_classification"),
    warnings: jsonb("warnings").$type<readonly string[]>().notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_market_snapshot_series_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_snapshot_series_market_snapshot_id",
      columns: [t.marketSnapshotId],
      foreignColumns: [marketSnapshot.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_market_snapshot_series_controlled_instrument_id",
      columns: [t.controlledInstrumentId],
      foreignColumns: [marketInstrument.id],
    }).onDelete("restrict"),
    unique("uq_market_snapshot_series_workspace_snapshot_position").on(
      t.workspaceId,
      t.marketSnapshotId,
      t.position,
    ),
    unique("uq_market_snapshot_series_workspace_snapshot_descriptor").on(
      t.workspaceId,
      t.marketSnapshotId,
      t.descriptorIdentity,
    ),
    check(
      "ck_market_snapshot_series_position_positive",
      sql`${t.position} > 0`,
    ),
    check(
      "ck_market_snapshot_series_outcome_shape",
      sql`(${t.outcome} = 'succeeded' and ${t.provider} is not null and ${t.mapping} is not null and ${t.points} is not null and ${t.failureCode} is null) or (${t.outcome} = 'failed' and ${t.points} is null and ${t.failureCode} is not null)`,
    ),
    check(
      "ck_market_snapshot_series_attempts_bounded",
      sql`${t.attemptedMappings} is null or (jsonb_typeof(${t.attemptedMappings}) = 'array' and jsonb_array_length(${t.attemptedMappings}) <= 4)`,
    ),
    check(
      "ck_market_snapshot_series_warnings_bounded",
      sql`jsonb_typeof(${t.warnings}) = 'array' and jsonb_array_length(${t.warnings}) <= 32`,
    ),
  ],
);
