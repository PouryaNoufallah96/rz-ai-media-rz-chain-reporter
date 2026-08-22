import {
  ADMISSION_OUTCOMES,
  admissionOutcomeSchema,
  articleAdapterSchema,
  contentLocaleSchema,
  enrichmentOutcomeSchema,
  enrichmentReasonSchema,
} from "@rz-chain-reporter/contracts";
import {
  createLoader,
  type inferParserType,
  type Nullable,
  parseAsString,
  parseAsStringLiteral,
  type SearchParams,
} from "nuqs/server";
import { z } from "zod";

export const streamSearchParsers = {
  source: parseAsString,
  admission: parseAsStringLiteral(ADMISSION_OUTCOMES),
  import: parseAsString,
  cursor: parseAsString,
};

export const loadStreamSearchParams = createLoader(streamSearchParsers);

export type StreamSearchParams = Promise<SearchParams>;

export type StreamSearchPatch = Partial<
  Nullable<inferParserType<typeof streamSearchParsers>>
>;

const optionalIdSchema = z.uuid().nullable().catch(null);

const streamQuerySchema = z.object({
  source: optionalIdSchema,
  admission: admissionOutcomeSchema.nullable(),
  import: optionalIdSchema,
  cursor: z.string().min(1).max(512).nullable().catch(null),
});

export type StreamQuery = z.infer<typeof streamQuerySchema>;

export function normalizeStreamQuery(
  input: Awaited<ReturnType<typeof loadStreamSearchParams>>,
): StreamQuery {
  return streamQuerySchema.parse(input);
}

export const streamCursorSchema = z.object({
  direction: z.enum(["older", "newer"]),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

export type StreamCursor = z.infer<typeof streamCursorSchema>;

export const sourceItemBriefSchema = z.object({ summary: z.string() });

const sourceItemRowSchema = z.object({
  id: z.uuid(),
  createdAt: z.date(),
  sourceId: z.uuid(),
  sourceName: z.string(),
  title: z.string(),
  canonicalUrl: z.string(),
  contentLocale: contentLocaleSchema,
  contentHash: z.string(),
  revisionCount: z.int().positive(),
  admission: admissionOutcomeSchema.nullable(),
  rank: z.int().nullable(),
  keywordScore: z.number().nullable(),
  enrichment: enrichmentOutcomeSchema.nullable(),
  enrichmentReason: enrichmentReasonSchema.nullable(),
  adapter: articleAdapterSchema.nullable(),
  fallbackReason: enrichmentReasonSchema.nullable(),
  brief: z.array(z.string()).nullable(),
});

export type SourceItemRow = z.infer<typeof sourceItemRowSchema>;

const sourceItemPageSchema = z.object({
  rows: z.array(sourceItemRowSchema),
  olderCursor: z.string().nullable(),
  newerCursor: z.string().nullable(),
  offLatest: z.boolean(),
});

export type SourceItemPage = z.infer<typeof sourceItemPageSchema>;

const sourceItemStreamSchema = z.object({
  page: sourceItemPageSchema,
  query: streamQuerySchema,
  hasAnyItem: z.boolean(),
  sourceOptions: z.array(z.object({ id: z.uuid(), name: z.string() })),
  importOptions: z.array(z.object({ id: z.uuid(), createdAt: z.date() })),
});

export type SourceItemStream = z.infer<typeof sourceItemStreamSchema>;
