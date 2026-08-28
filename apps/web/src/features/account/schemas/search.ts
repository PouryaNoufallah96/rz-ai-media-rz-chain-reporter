import {
  createLoader,
  parseAsString,
  parseAsStringLiteral,
  type SearchParams,
} from "nuqs/server";
import { z } from "zod";

import { ACCOUNT_SAVED_STATES } from "../constants";

export const accountSearchParsers = {
  draft: parseAsString,
  savedState: parseAsStringLiteral(ACCOUNT_SAVED_STATES).withDefault("active"),
  savedCursor: parseAsString,
  auditCursor: parseAsString,
};

export const loadAccountSearchParams = createLoader(accountSearchParsers);

export type AccountSearchParams = Promise<SearchParams>;

const accountQuerySchema = z.strictObject({
  draft: z.string().min(1).max(200).nullable().catch(null),
  savedState: z.enum(ACCOUNT_SAVED_STATES),
  savedCursor: z.string().min(1).max(512).nullable().catch(null),
  auditCursor: z.string().min(1).max(512).nullable().catch(null),
});

export type AccountQuery = z.infer<typeof accountQuerySchema>;

export function normalizeAccountQuery(
  input: Awaited<ReturnType<typeof loadAccountSearchParams>>,
): AccountQuery {
  return accountQuerySchema.parse(input);
}
