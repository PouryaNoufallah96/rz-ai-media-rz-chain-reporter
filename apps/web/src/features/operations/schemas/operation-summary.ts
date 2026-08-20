import {
  attemptOutcomeSchema,
  errorCodeSchema,
  operationLifecycleSchema,
  platformSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

export const operationSummarySchema = z.object({
  attemptCount: z.int(),
  commandType: z.string(),
  createdAt: z.date(),
  effectiveAt: z.date(),
  failureCode: errorCodeSchema.nullable(),
  id: z.uuid(),
  latestAttemptOutcome: attemptOutcomeSchema.nullable(),
  lifecycle: operationLifecycleSchema,
  platform: platformSchema.nullable(),
  updatedAt: z.date(),
});

export type OperationSummary = z.infer<typeof operationSummarySchema>;
