import {
  marketChartSpecSchema,
  operatorImageDirectionSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

import { marketRequestSelectionSchema } from "./create";

const analysisId = z.uuid();
const expectedVersion = z.int().positive();
const idempotencyKey = z.string().trim().min(1).max(200);
const modelOptionKey = z.string().trim().min(1).max(80);

export const MARKET_STORY_HEADLINE_MAX = 80;
export const MARKET_STORY_TEXT_MAX = 240;

const ownedAnalysisInput = z.strictObject({
  analysisId,
  expectedVersion,
});

export const effectfulAnalysisInputSchema = ownedAnalysisInput.extend({
  idempotencyKey,
});
export const updateMarketRequestInputSchema =
  marketRequestSelectionSchema.safeExtend(effectfulAnalysisInputSchema.shape);
export const generateMarketAnalysisInputSchema =
  effectfulAnalysisInputSchema.extend({
    operatorDirection: operatorImageDirectionSchema,
    imageOptionKey: modelOptionKey,
  });
export const approveChartInputSchema = effectfulAnalysisInputSchema.extend({
  chartSpec: marketChartSpecSchema,
});
export const approveStoryInputSchema = ownedAnalysisInput.extend({
  headline: z
    .string()
    .trim()
    .min(1, { error: "MARKET_STORY_HEADLINE_REQUIRED" })
    .max(MARKET_STORY_HEADLINE_MAX),
  supportingText: z
    .string()
    .trim()
    .min(1, { error: "MARKET_STORY_TEXT_REQUIRED" })
    .max(MARKET_STORY_TEXT_MAX),
});
export const approveDesignInputSchema = ownedAnalysisInput.extend({
  familyKey: z.string().trim().min(1).max(80),
  variantKey: z.string().trim().min(1).max(80),
});
export const retryMarketGenerationInputSchema = z.strictObject({
  expectedEpoch: z.int().nonnegative(),
  operationId: z.uuid(),
  receipt: z.string().trim().min(1).max(200),
});
export const retryMarketCaptionsInputSchema = ownedAnalysisInput.extend({
  idempotencyKey,
  platformDraftId: z.uuid(),
  modelOptionKey: modelOptionKey.optional(),
});
export const approveStageInputSchema = ownedAnalysisInput;
export const saveChartDefaultInputSchema = z.strictObject({
  marketInstrumentId: z.uuid(),
  chartSpec: marketChartSpecSchema,
  expectedVersion: z.int().positive().nullable(),
});

export const marketAnalysisCommandResultSchema = z.strictObject({
  analysisId: z.uuid(),
  version: z.int().positive(),
  operationId: z.uuid().optional(),
  replayed: z.boolean(),
});

export const chartDefaultCommandResultSchema = z.strictObject({
  marketInstrumentId: z.uuid(),
  version: z.int().positive(),
});
