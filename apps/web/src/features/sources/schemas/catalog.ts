import {
  contentLocaleSchema,
  sourceFetchOutcomeSchema,
  sourceFetchReasonSchema,
  sourceOriginSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

import { SOURCE_LIFECYCLES } from "../constants";

const sourceObservationSchema = z.object({
  outcome: sourceFetchOutcomeSchema,
  reason: sourceFetchReasonSchema.nullable(),
  fetchedCount: z.int().nonnegative(),
  admittedCount: z.int().nonnegative(),
  observedAt: z.date(),
  hasValidators: z.boolean(),
  importRunning: z.boolean(),
});

export type SourceObservation = z.infer<typeof sourceObservationSchema>;

const sourceCatalogEntrySchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  origin: sourceOriginSchema,
  endpoint: z.string(),
  contentLocale: contentLocaleSchema,
  lifecycle: z.enum(SOURCE_LIFECYCLES),
  observation: sourceObservationSchema.nullable(),
});

export type SourceCatalogEntry = z.infer<typeof sourceCatalogEntrySchema>;

const sourceCatalogSchema = z.object({
  entries: z.array(sourceCatalogEntrySchema),
  itemCap: z.int().positive(),
  lastImportAt: z.date().nullable(),
});

export type SourceCatalog = z.infer<typeof sourceCatalogSchema>;
