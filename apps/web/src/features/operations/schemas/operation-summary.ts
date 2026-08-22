import {
  attemptOutcomeSchema,
  dispatchStateSchema,
  errorCodeSchema,
  invocationKeySchema,
  operationLifecycleSchema,
  platformSchema,
  sourceImportStageSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

export const operationSummarySchema = z.object({
  attemptCount: z.int(),
  commandType: z.string(),
  createdAt: z.date(),
  dispatch: z
    .object({
      nextAttemptAt: z.date(),
      state: dispatchStateSchema,
    })
    .nullable(),
  effectiveAt: z.date(),
  failureCode: errorCodeSchema.nullable(),
  id: z.uuid(),
  latestAttemptOutcome: attemptOutcomeSchema.nullable(),
  lifecycle: operationLifecycleSchema,
  platform: platformSchema.nullable(),
  sourceImport: z
    .object({
      stage: sourceImportStageSchema,
      partial: z.boolean(),
      counts: z.object({
        acquired: z.int().nonnegative(),
        ordered: z.int().nonnegative(),
        enriched: z.int().nonnegative(),
        skipped: z.int().nonnegative(),
        failed: z.int().nonnegative(),
      }),
      unitsPlanned: z.int().nonnegative(),
    })
    .optional(),
  timeline: z.array(
    z.object({
      at: z.date(),
      kind: z.enum([
        "received",
        "dispatched",
        "started",
        "modelCall",
        "waiting",
        "effectRecorded",
        "settled",
      ]),
      outcome: attemptOutcomeSchema.nullable(),
      slot: invocationKeySchema.nullable(),
      sourceId: z.uuid(),
    }),
  ),
  updatedAt: z.date(),
  version: z.int().positive(),
});

export type OperationSummary = z.infer<typeof operationSummarySchema>;
