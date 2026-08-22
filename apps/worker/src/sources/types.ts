import { createHash } from "node:crypto";
import type {
  AdmissionOutcome,
  ContentLocale,
  SourceFetchOutcome,
  SourceFetchReason,
  SourceOrigin,
} from "@rz-chain-reporter/contracts";

// Only the two dispositions the fetcher alone can see: a feed owns publication
// dates and upstream language. out_of_window and over_cap belong to ordering.
export type FetchedAdmission = Extract<
  AdmissionOutcome,
  "admitted" | "skipped_language" | "skipped_undated"
>;

export type SourceFetchRequest = {
  contentLocale: ContentLocale;
  endpoint: string;
  etag: string | null;
  lastModified: string | null;
  maxItems: number;
  name: string;
  origin: SourceOrigin;
  timeoutMs: number;
};

export type FetchedSourceItem = {
  admission: FetchedAdmission;
  attribution: string;
  canonicalUrl: string;
  contentHash: string;
  contentLocale: ContentLocale;
  externalId: string;
  publishedAt: Date | null;
  summary: string | null;
  title: string;
  views: number | null;
};

export type SourceFetchResult = {
  etag: string | null;
  items: readonly FetchedSourceItem[];
  lastModified: string | null;
  outcome: SourceFetchOutcome;
  reason: SourceFetchReason | null;
};

const CONTENT_HASH_SEPARATOR = "\u0000";

// Views are excluded so a re-read that only changes them keeps the existing revision.
export function contentHashV1(item: {
  canonicalUrl: string;
  contentLocale: ContentLocale;
  summary: string | null;
  title: string;
}) {
  return createHash("sha256")
    .update(
      [
        item.title,
        item.summary ?? "",
        item.canonicalUrl,
        item.contentLocale,
      ].join(CONTENT_HASH_SEPARATOR),
    )
    .digest("hex");
}
