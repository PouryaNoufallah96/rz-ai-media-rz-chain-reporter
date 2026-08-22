import type { EnrichmentReason } from "@rz-chain-reporter/contracts";

import { fetchDirectArticle } from "./direct-http";
import { fetchFirecrawlArticle } from "./firecrawl";
import {
  type ArticleBindings,
  type ArticleFetchRequest,
  type ArticleFetchResult,
  EXTRACT_MAX_CHARS,
  FEED_CONTENT_SUFFICIENT_CHARS,
  sameArticleOrigin,
} from "./types";

// Security and policy refusals never fall back; only these three do.
const FALLBACK_REASONS = [
  "anti_bot_challenge",
  "extraction_insufficient",
  "js_required",
] as const;

export async function fetchArticle(
  request: ArticleFetchRequest,
  bindings: ArticleBindings,
): Promise<ArticleFetchResult> {
  const feed = sufficientFeedContent(request.feedContent);
  if (feed !== null) {
    return { adapter: "feed", fallbackReason: null, text: feed };
  }
  if (!sameArticleOrigin(request.url, request.endpointOrigin)) {
    return { adapter: null, reason: "off_origin" };
  }
  if (request.mode === "firecrawl") {
    return await fetchFirecrawlArticle(request, bindings, null);
  }

  const direct = await fetchDirectArticle(request);
  if (
    request.mode === "direct" ||
    direct.adapter !== null ||
    !fallbackEligible(direct.reason)
  ) {
    return direct;
  }
  return await fetchFirecrawlArticle(request, bindings, direct.reason);
}

function sufficientFeedContent(feedContent: string | null) {
  const text = feedContent?.trim() ?? "";
  return text.length >= FEED_CONTENT_SUFFICIENT_CHARS
    ? text.slice(0, EXTRACT_MAX_CHARS).trim()
    : null;
}

function fallbackEligible(reason: EnrichmentReason) {
  return FALLBACK_REASONS.some((eligible) => eligible === reason);
}
