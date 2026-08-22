import type { EnrichmentReason } from "@rz-chain-reporter/contracts";
import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";
import Firecrawl, { SdkError } from "firecrawl";

import { isAllowedUntrustedUrl } from "../fetch/safe-http";
import { workerLogger } from "../logging/logger";
import { WorkerRuntimeBindingError } from "../runtime/config";
import {
  type ArticleBindings,
  type ArticleFetchRequest,
  type ArticleFetchResult,
  EXTRACT_FLOOR_CHARS,
  EXTRACT_MAX_CHARS,
  sameArticleOrigin,
} from "./types";

// The SDK's `maxRetries` bounds `for (attempt = 0; attempt < maxRetries)`, so
// it counts attempts: 0 sends no request at all.
const FIRECRAWL_MAX_ATTEMPTS = 1;
const ABORT_CODES = ["ECONNABORTED", "ETIMEDOUT"];
const REQUEST_TIMEOUT_STATUS = 408;

let client: Firecrawl | undefined;

export function assertFirecrawlBinding(
  template: CustomerTemplate,
  bindings: ArticleBindings,
) {
  const selected = template.sources.some(
    (source) =>
      source.enabled &&
      source.origin === "rss" &&
      source.articleFetchMode !== "direct",
  );

  if (selected && bindings.FIRECRAWL_API_KEY === undefined) {
    throw new WorkerRuntimeBindingError(["firecrawl"]);
  }
}

export async function fetchFirecrawlArticle(
  request: ArticleFetchRequest,
  bindings: ArticleBindings,
  fallbackReason: EnrichmentReason | null,
): Promise<ArticleFetchResult> {
  const apiKey = bindings.FIRECRAWL_API_KEY;
  if (apiKey === undefined) {
    throw new WorkerRuntimeBindingError(["firecrawl"]);
  }

  if (!(await isAllowedUntrustedUrl(request.url))) {
    return { adapter: null, reason: "ssrf_blocked" };
  }

  client ??= new Firecrawl({ apiKey, maxRetries: FIRECRAWL_MAX_ATTEMPTS });

  let markdown: string | undefined;
  let returnedUrl: string | undefined;
  try {
    const document = await client.scrape(request.url, {
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: request.timeoutMs,
    });
    markdown = document.markdown;
    returnedUrl = document.metadata?.url ?? document.metadata?.sourceURL;
  } catch (error) {
    return { adapter: null, reason: firecrawlFailureReason(error) };
  }

  if (!sameArticleOrigin(returnedUrl ?? request.url, request.endpointOrigin)) {
    return { adapter: null, reason: "off_origin" };
  }

  const text = (markdown ?? "").trim().slice(0, EXTRACT_MAX_CHARS).trim();
  if (text.length < EXTRACT_FLOOR_CHARS) {
    return { adapter: null, reason: "extraction_insufficient" };
  }
  return { adapter: "firecrawl", fallbackReason, text };
}

// ENRICHMENT_REASONS carries no provider-account member, so an expired key,
// exhausted credit, and a rate limit settle alike and separate only in the log.
function firecrawlFailureReason(error: unknown): EnrichmentReason {
  const status = error instanceof SdkError ? error.status : undefined;
  const code = error instanceof SdkError ? error.code : undefined;
  const reason =
    status === REQUEST_TIMEOUT_STATUS ||
    (code !== undefined && ABORT_CODES.includes(code))
      ? "deadline"
      : "fetch_failed";

  workerLogger.warn("article.firecrawl_failed", {
    adapter: "firecrawl",
    errorCode: code,
    reason,
    status: status === undefined ? "none" : String(status),
  });
  return reason;
}
