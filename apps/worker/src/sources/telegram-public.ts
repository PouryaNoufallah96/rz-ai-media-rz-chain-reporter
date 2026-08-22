import { DomUtils, parseDocument } from "htmlparser2";

import { type SafeHttpResponse, safeFetch } from "../fetch/safe-http";
import {
  contentHashV1,
  type FetchedSourceItem,
  type SourceFetchRequest,
  type SourceFetchResult,
} from "./types";

const CHANNEL_MAX_DECODED_BYTES = 1_048_576;
const CHANNEL_MIME_ALLOWLIST = ["text/html"];
const CHANNEL_ACCEPT = "text/html";
const USER_AGENT = "ChainReporter/1.0";
const HANDLE_GRAMMAR = /^[A-Za-z0-9_]{4,32}$/;
const PREVIEW_PATH_PREFIX = "/s/";
const SUMMARY_MAX_CHARS = 8_000;
const TITLE_MAX_CHARS = 200;

const POST_MARKER = /data-post="([^"]+)"/g;
const MESSAGE_TEXT =
  /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/;
const MESSAGE_TIME = /<time[^>]+datetime="([^"]+)"/;
const MESSAGE_VIEWS = /<span class="tgme_widget_message_views">([^<]*)<\/span>/;
const VIEWS_VALUE = /^([\d.]+)([KMB]?)$/i;
const VIEWS_MULTIPLIER: Record<string, number> = {
  b: 1_000_000_000,
  k: 1_000,
  m: 1_000_000,
};

export async function fetchTelegramSource(
  request: SourceFetchRequest,
): Promise<SourceFetchResult> {
  if (!HANDLE_GRAMMAR.test(request.endpoint)) {
    return {
      etag: null,
      items: [],
      lastModified: null,
      outcome: "rejected",
      reason: "no_web_preview",
    };
  }

  const response = await safeFetch({
    headers: { accept: CHANNEL_ACCEPT, "user-agent": USER_AGENT },
    maxDecodedBytes: CHANNEL_MAX_DECODED_BYTES,
    mimeAllowlist: CHANNEL_MIME_ALLOWLIST,
    timeoutMs: request.timeoutMs,
    url: `https://t.me/s/${request.endpoint}`,
  });

  return readTelegramChannel(request, response);
}

export function readTelegramChannel(
  request: SourceFetchRequest,
  response: SafeHttpResponse,
): SourceFetchResult {
  const settled = { etag: null, lastModified: null };

  // Groups and channels without a web preview redirect off /s/.
  if (!new URL(response.url).pathname.startsWith(PREVIEW_PATH_PREFIX)) {
    return {
      ...settled,
      items: [],
      outcome: "rejected",
      reason: "no_web_preview",
    };
  }

  const blocks = messageBlocks(response.text);
  if (blocks.length === 0) {
    const empty =
      response.text.includes("tgme_channel_history") &&
      !response.text.includes("tgme_widget_message");
    return {
      ...settled,
      items: [],
      outcome: empty ? "skipped" : "partial",
      reason: empty ? "empty_feed" : "markup_drift",
    };
  }

  const items: FetchedSourceItem[] = [];
  let drifted = 0;

  for (const block of blocks.slice(-request.maxItems)) {
    const item = readMessage(request, block);
    if (item === null) {
      drifted += 1;
    } else {
      items.push(item);
    }
  }

  if (drifted > 0) {
    return { ...settled, items, outcome: "partial", reason: "markup_drift" };
  }
  return { ...settled, items, outcome: "succeeded", reason: null };
}

function readMessage(
  request: SourceFetchRequest,
  block: { markup: string; post: string },
): FetchedSourceItem | null {
  const [channel, messageId] = block.post.split("/");
  if (channel !== request.endpoint || !/^\d+$/.test(messageId ?? "")) {
    return null;
  }

  const text = plainText(MESSAGE_TEXT.exec(block.markup)?.[1] ?? "");
  const publishedAt = parseDate(MESSAGE_TIME.exec(block.markup)?.[1]);
  if (text === "" && publishedAt === null) {
    return null;
  }

  const summary = bounded(text, SUMMARY_MAX_CHARS);
  const content = {
    canonicalUrl: `https://t.me/${block.post}`,
    contentLocale: request.contentLocale,
    summary: summary === "" ? null : summary,
    title: bounded(text.split("\n")[0] ?? "", TITLE_MAX_CHARS),
  };

  return {
    ...content,
    admission: publishedAt === null ? "skipped_undated" : "admitted",
    attribution: request.name,
    contentHash: contentHashV1(content),
    externalId: block.post,
    publishedAt,
    views: parseViews(MESSAGE_VIEWS.exec(block.markup)?.[1]),
  };
}

function messageBlocks(html: string) {
  const found = [...html.matchAll(POST_MARKER)];

  return found.map((match, index) => ({
    markup: html.slice(match.index, found[index + 1]?.index ?? html.length),
    post: match[1] ?? "",
  }));
}

function parseViews(raw: string | undefined) {
  const value = VIEWS_VALUE.exec(raw?.trim() ?? "");
  if (value === null) {
    return null;
  }
  const scale = VIEWS_MULTIPLIER[value[2]?.toLowerCase() ?? ""] ?? 1;
  const views = Math.round(Number(value[1]) * scale);
  return Number.isFinite(views) ? views : null;
}

function parseDate(raw: string | undefined) {
  if (raw === undefined) {
    return null;
  }
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

function plainText(value: string) {
  return decodeEntities(
    value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Escaping `<` first keeps this a pure decoder: no leftover angle bracket in
// the stripped message text can reopen a tag for the tokenizer.
function decodeEntities(value: string) {
  return value.includes("&")
    ? DomUtils.textContent(parseDocument(value.replace(/</g, "&lt;")))
    : value;
}

function bounded(value: string, maxChars: number) {
  return value.length > maxChars ? value.slice(0, maxChars).trim() : value;
}
