import {
  attemptOutcomeSchema,
  dispatchStateSchema,
  errorCodeSchema,
  invocationKeySchema,
  operationLifecycleSchema,
  platformSchema,
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
