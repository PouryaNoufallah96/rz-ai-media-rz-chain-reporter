import {
  contentLocaleSchema,
  marketOutputFormatSchema,
  marketPeriodSchema,
  marketScaleSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

const instrumentId = z.uuid({ error: "MARKET_INSTRUMENT_REQUIRED" });
export const MARKET_ENTRY_PRIMARY_LIMIT = 3;
export const MARKET_ENTRY_COMPARISON_LIMIT = 3;

export const marketRequestSelectionSchema = z
  .strictObject({
    primaryInstrumentIds: z
      .array(instrumentId)
      .min(1, { error: "MARKET_PRIMARY_REQUIRED" })
      .max(MARKET_ENTRY_PRIMARY_LIMIT, { error: "MARKET_PRIMARY_LIMIT" }),
    brandingInstrumentId: instrumentId,
    comparisonCatalogIdentities: z
      .array(z.string().trim().min(1).max(80))
      .max(MARKET_ENTRY_COMPARISON_LIMIT, {
        error: "MARKET_COMPARISON_LIMIT",
      }),
    period: marketPeriodSchema,
    scale: marketScaleSchema,
    outputFormat: marketOutputFormatSchema,
    contentLocale: contentLocaleSchema,
  })
  .superRefine((input, context) => {
    if (
      new Set(input.primaryInstrumentIds).size !==
      input.primaryInstrumentIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "MARKET_PRIMARY_DUPLICATE",
        path: ["primaryInstrumentIds"],
      });
    }
    if (!input.primaryInstrumentIds.includes(input.brandingInstrumentId)) {
      context.addIssue({
        code: "custom",
        message: "MARKET_BRANDING_REQUIRED",
        path: ["brandingInstrumentId"],
      });
    }
    if (
      new Set(input.comparisonCatalogIdentities).size !==
      input.comparisonCatalogIdentities.length
    ) {
      context.addIssue({
        code: "custom",
        message: "MARKET_COMPARISON_DUPLICATE",
        path: ["comparisonCatalogIdentities"],
      });
    }
  });

export type MarketRequestSelectionInput = z.input<
  typeof marketRequestSelectionSchema
>;

export const createMarketAnalysisInputSchema =
  marketRequestSelectionSchema.safeExtend({
    idempotencyKey: z.string().trim().min(1).max(200),
  });
