import type { EnrichmentReason } from "@rz-chain-reporter/contracts";
import { DomUtils, ElementType, parseDocument } from "htmlparser2";

import {
  SafeHttpError,
  type SafeHttpFailure,
  type SafeHttpResponse,
  safeFetch,
} from "../fetch/safe-http";
import {
  type ArticleFetchRequest,
  type ArticleFetchResult,
  EXTRACT_FLOOR_CHARS,
  EXTRACT_MAX_CHARS,
} from "./types";

const PAGE_MAX_DECODED_BYTES = 2_097_152;
const PAGE_MIME_ALLOWLIST = ["application/xhtml+xml", "text/html"];
const PAGE_ACCEPT = "text/html,application/xhtml+xml";
const USER_AGENT = "ChainReporter/1.0";
const CHALLENGE_STATUSES = new Set([401, 403, 429]);
const JS_REQUIRED_MARKER = /enable (javascript|js)\b/i;
const MIN_PARAGRAPH_CHARS = 80;
const SKIPPED_CONTAINERS = new Set([
  "aside",
  "figure",
  "footer",
  "form",
  "header",
  "nav",
  "noscript",
  "script",
  "style",
  "template",
]);

type DomNodes = ReturnType<typeof parseDocument>["children"];

export async function fetchDirectArticle(
  request: ArticleFetchRequest,
): Promise<ArticleFetchResult> {
  try {
    const response = await safeFetch({
      headers: { accept: PAGE_ACCEPT, "user-agent": USER_AGENT },
      maxDecodedBytes: PAGE_MAX_DECODED_BYTES,
      mimeAllowlist: PAGE_MIME_ALLOWLIST,
      timeoutMs: request.timeoutMs,
      url: request.url,
    });
    return readArticlePage(response);
  } catch (error) {
    if (!(error instanceof SafeHttpError)) {
      throw error;
    }
    return { adapter: null, reason: enrichmentReasonOf(error.reason) };
  }
}

export function readArticlePage(
  response: SafeHttpResponse,
): ArticleFetchResult {
  if (CHALLENGE_STATUSES.has(response.status)) {
    return { adapter: null, reason: "anti_bot_challenge" };
  }
  if (response.status < 200 || response.status > 299) {
    return { adapter: null, reason: "fetch_failed" };
  }

  const text = extractArticleText(response.text);
  if (text.length < EXTRACT_FLOOR_CHARS) {
    return {
      adapter: null,
      reason: JS_REQUIRED_MARKER.test(response.text)
        ? "js_required"
        : "extraction_insufficient",
    };
  }
  return { adapter: "direct", fallbackReason: null, text };
}

// U.Today has no <article>; NewsBTC's <article> is thinner than the full page. Take the denser set.
export function extractArticleText(html: string) {
  const document = parseDocument(html);
  const wholePage = paragraphsOf(document.children);
  const article = DomUtils.findOne(
    (element) => element.name === "article",
    document.children,
    true,
  );
  const scoped = article === null ? [] : paragraphsOf(article.children);
  const chosen =
    totalLength(scoped) > totalLength(wholePage) ? scoped : wholePage;
  const text = chosen.join("\n\n");

  return text.length > EXTRACT_MAX_CHARS
    ? text.slice(0, EXTRACT_MAX_CHARS).trim()
    : text;
}

function paragraphsOf(nodes: DomNodes) {
  const paragraphs: string[] = [];
  collectParagraphs(nodes, paragraphs);
  return paragraphs;
}

function collectParagraphs(nodes: DomNodes, paragraphs: string[]) {
  for (const node of nodes) {
    if (node.type !== ElementType.Tag || SKIPPED_CONTAINERS.has(node.name)) {
      continue;
    }
    if (node.name !== "p") {
      collectParagraphs(node.children, paragraphs);
      continue;
    }
    const text = DomUtils.textContent(node).replace(/\s+/g, " ").trim();
    if (text.length >= MIN_PARAGRAPH_CHARS) {
      paragraphs.push(text);
    }
  }
}

function totalLength(paragraphs: readonly string[]) {
  return paragraphs.reduce((total, text) => total + text.length, 0);
}

// Treat 429/503 as the article-page anti-bot checkpoint.
function enrichmentReasonOf(reason: SafeHttpFailure): EnrichmentReason {
  return reason === "retry_after" ? "anti_bot_challenge" : reason;
}
