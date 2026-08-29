import { XMLParser } from "fast-xml-parser";

import {
  SafeHttpError,
  type SafeHttpResponse,
  safeFetch,
} from "../fetch/safe-http";
import {
  bounded,
  contentHashV1,
  decodeEntities,
  type FetchedAdmission,
  type FetchedSourceItem,
  parseDate,
  type SourceFetchRequest,
  type SourceFetchResult,
} from "./types";

const FEED_MAX_DECODED_BYTES = 4_194_304;
const FEED_MIME_ALLOWLIST = [
  "application/atom+xml",
  "application/rss+xml",
  "application/xml",
  "text/xml",
];
const FEED_ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9";
const USER_AGENT = "ChainReporter/1.0";
const SUMMARY_MAX_CHARS = 8_000;
const TITLE_MAX_CHARS = 512;

// fast-xml-parser 5.11.0 has no DOCTYPE switch; the prolog gate plus these bounds are the DTD defence.
const feedParser = new XMLParser({
  attributeNamePrefix: "@",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: {
    enabled: true,
    maxEntityCount: 16,
    maxEntitySize: 1_024,
    maxExpandedLength: 65_536,
    maxExpansionDepth: 2,
    maxTotalExpansions: 50_000,
  },
  trimValues: true,
});

type FeedDocument = {
  entries: unknown[];
  language: string | null;
};

export async function fetchRssAtomSource(
  request: SourceFetchRequest,
): Promise<SourceFetchResult> {
  const headers: Record<string, string> = {
    accept: FEED_ACCEPT,
    "user-agent": USER_AGENT,
  };
  if (request.etag !== null) {
    headers["if-none-match"] = request.etag;
  } else if (request.lastModified !== null) {
    headers["if-modified-since"] = request.lastModified;
  }

  const response = await safeFetch({
    headers,
    maxDecodedBytes: FEED_MAX_DECODED_BYTES,
    mimeAllowlist: FEED_MIME_ALLOWLIST,
    timeoutMs: request.timeoutMs,
    url: request.endpoint,
  });

  return readRssAtomFeed(request, response);
}

export function readRssAtomFeed(
  request: SourceFetchRequest,
  response: SafeHttpResponse,
): SourceFetchResult {
  const settled = {
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };

  if (response.status === 304) {
    return { ...settled, items: [], outcome: "not_modified", reason: null };
  }
  if (response.status < 200 || response.status > 299) {
    throw new SafeHttpError("fetch_failed", new URL(request.endpoint).hostname);
  }

  const document = parseFeedDocument(response.text);
  if (document === null) {
    return {
      ...settled,
      items: [],
      outcome: "rejected",
      reason: "parse_failure",
    };
  }
  if (document.entries.length === 0) {
    return { ...settled, items: [], outcome: "skipped", reason: "empty_feed" };
  }

  const admission = languageAdmission(document.language, request.contentLocale);
  const items: FetchedSourceItem[] = [];
  let identityless = 0;

  for (const entry of document.entries.slice(0, request.maxItems)) {
    const item = readEntry(request, entry, admission);
    if (item === null) {
      identityless += 1;
    } else {
      items.push(item);
    }
  }

  if (identityless > 0) {
    return {
      ...settled,
      items,
      outcome: "partial",
      reason: "missing_external_identity",
    };
  }
  return { ...settled, items, outcome: "succeeded", reason: null };
}

function readEntry(
  request: SourceFetchRequest,
  entry: unknown,
  admission: FetchedAdmission,
): FetchedSourceItem | null {
  if (!isRecord(entry)) {
    return null;
  }

  const canonicalUrl = absoluteHttpUrl(
    textOf(entry.link) ?? atomHref(entry.link),
    request.endpoint,
  );
  const externalId = textOf(entry.guid) ?? textOf(entry.id) ?? canonicalUrl;
  if (externalId === null || canonicalUrl === null) {
    return null;
  }

  const publishedAt = parseDate(
    textOf(entry.pubDate) ??
      textOf(entry["dc:date"]) ??
      textOf(entry.published) ??
      textOf(entry.updated),
  );
  const title = bounded(plainText(textOf(entry.title) ?? ""), TITLE_MAX_CHARS);
  const summary = bounded(
    plainText(
      longest([
        textOf(entry["content:encoded"]),
        textOf(entry.content),
        textOf(entry.description),
        textOf(entry.summary),
      ]),
    ),
    SUMMARY_MAX_CHARS,
  );
  const content = {
    canonicalUrl,
    contentLocale: request.contentLocale,
    summary: summary === "" ? null : summary,
    title,
  };

  return {
    ...content,
    admission: publishedAt === null ? "skipped_undated" : admission,
    attribution: request.name,
    contentHash: contentHashV1(content),
    externalId,
    publishedAt,
    views: null,
  };
}

function parseFeedDocument(xml: string): FeedDocument | null {
  const rootAt = xml.search(/<[A-Za-z]/);
  if (rootAt < 0 || /<!DOCTYPE/i.test(xml.slice(0, rootAt))) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = feedParser.parse(xml);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }

  const channel = firstRecord(isRecord(parsed.rss) ? parsed.rss.channel : null);
  if (channel !== null) {
    return {
      entries: listOf(channel.item),
      language: textOf(channel.language),
    };
  }

  const feed = firstRecord(parsed.feed);
  if (feed !== null) {
    return { entries: listOf(feed.entry), language: textOf(feed["@xml:lang"]) };
  }

  return null;
}

function languageAdmission(
  language: string | null,
  contentLocale: SourceFetchRequest["contentLocale"],
): FetchedAdmission {
  if (language === null) {
    return "admitted";
  }
  const primary = language.split("-")[0]?.toLowerCase();
  return primary === contentLocale ? "admitted" : "skipped_language";
}

function atomHref(value: unknown): string | null {
  for (const link of listOf(value)) {
    if (!isRecord(link)) {
      continue;
    }
    const rel = textOf(link["@rel"]);
    if (rel !== null && rel !== "alternate") {
      continue;
    }
    const href = textOf(link["@href"]);
    if (href !== null) {
      return href;
    }
  }
  return null;
}

function absoluteHttpUrl(raw: string | null, base: string) {
  if (raw === null) {
    return null;
  }
  try {
    const url = new URL(raw, base);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function longest(values: readonly (string | null)[]) {
  let best = "";
  for (const value of values) {
    if (value !== null && value.length > best.length) {
      best = value;
    }
  }
  return best;
}

function plainText(value: string) {
  return decodeEntities(
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = textOf(entry);
      if (text !== null) {
        return text;
      }
    }
    return null;
  }
  return isRecord(value) ? textOf(value["#text"]) : null;
}

function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
}

function firstRecord(value: unknown) {
  const [first] = listOf(value);
  return isRecord(first) ? first : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
