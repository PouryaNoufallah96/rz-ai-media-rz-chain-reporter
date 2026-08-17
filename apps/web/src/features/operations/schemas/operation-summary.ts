import {
  attemptOutcomeSchema,
  errorCodeSchema,
  operationLifecycleSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

// `platform` stays a plain string here: its value set is owned by the
// packages/db pgEnum, and packages/db must not be reachable from a schema the
// browser can import.
export const operationSummarySchema = z.object({
  attemptCount: z.int(),
  commandType: z.string(),
  createdAt: z.date(),
  effectiveAt: z.date(),
  failureCode: errorCodeSchema.nullable(),
  id: z.uuid(),
  latestAttemptOutcome: attemptOutcomeSchema.nullable(),
  lifecycle: operationLifecycleSchema,
  platform: z.string().nullable(),
  updatedAt: z.date(),
});

export type OperationSummary = z.infer<typeof operationSummarySchema>;
