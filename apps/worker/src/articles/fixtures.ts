import { Headers } from "undici";

import type { SafeHttpResponse } from "../fetch/safe-http";
import { extractArticleText, readArticlePage } from "./direct-http";
import { fetchArticle } from "./fetcher";
import {
  type ArticleFetchRequest,
  type ArticleFetchResult,
  EXTRACT_FLOOR_CHARS,
  FEED_CONTENT_SUFFICIENT_CHARS,
} from "./types";

const ENDPOINT_ORIGIN = "https://article.example.test";
const ARTICLE_URL = `${ENDPOINT_ORIGIN}/posts/one`;
const BODY_SENTENCE =
  "Spot volume rose overnight as desks rotated into the majors, and the order book thinned out well before the New York open, which left the move exposed.";
const CHROME_LABEL = "Subscribe to our newsletter";
const OUTSIDE_ARTICLE_MARKER = "Regulators are expected to respond";

function bodyParagraphs(count: number, sentence: string) {
  return Array.from(
    { length: count },
    (_, index) => `<p>${index + 1}. ${sentence}</p>`,
  ).join("");
}

const ARTICLE_ELEMENT_PAGE = `<!DOCTYPE html><html><body>
<nav><p>Markets</p><p>Policy</p></nav>
<article>${bodyParagraphs(8, BODY_SENTENCE)}</article>
<footer><p>${CHROME_LABEL}</p></footer>
</body></html>`;

const NO_ARTICLE_ELEMENT_PAGE = `<!DOCTYPE html><html><body>
<div class="content">${bodyParagraphs(9, BODY_SENTENCE)}</div>
<footer><p>${CHROME_LABEL}</p></footer>
</body></html>`;

const ARTICLE_SUBSET_PAGE = `<!DOCTYPE html><html><body>
<article><p>${BODY_SENTENCE}</p></article>
<div class="body">${bodyParagraphs(10, BODY_SENTENCE)}<p>${OUTSIDE_ARTICLE_MARKER} once the consultation window closes at the end of the quarter.</p></div>
</body></html>`;

const CHROME_HEAVY_PAGE = `<!DOCTYPE html><html><body>
<nav>${Array.from({ length: 200 }, () => `<p>${CHROME_LABEL}</p>`).join("")}</nav>
<article>${bodyParagraphs(8, BODY_SENTENCE)}</article>
</body></html>`;

const THIN_PAGE =
  "<!DOCTYPE html><html><body><article><p>Two sentences only. Nothing else rendered on the server side of this page at all.</p></article></body></html>";

const JS_REQUIRED_PAGE = `<!DOCTYPE html><html><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;

const CHALLENGE_PAGE = "";

const FEED_BODY = `${BODY_SENTENCE} `.repeat(12).trim();

const REACHABLE_FIRECRAWL = { FIRECRAWL_API_KEY: "fixture-unusable-key" };

const request = (
  overrides: Partial<ArticleFetchRequest> = {},
): ArticleFetchRequest => ({
  endpointOrigin: ENDPOINT_ORIGIN,
  feedContent: null,
  mode: "direct",
  timeoutMs: 15_000,
  url: ARTICLE_URL,
  ...overrides,
});

type ArticleFixture = {
  actual: () => Promise<string> | string;
  expected: string;
  name: string;
};

const FIXTURES: readonly ArticleFixture[] = [
  {
    actual: () => summarize(readArticlePage(page(ARTICLE_ELEMENT_PAGE))),
    expected: "adapter=direct reason=none fallback=none floorMet=true",
    name: "shape-article-element",
  },
  {
    actual: () => summarize(readArticlePage(page(NO_ARTICLE_ELEMENT_PAGE))),
    expected: "adapter=direct reason=none fallback=none floorMet=true",
    name: "shape-no-article-element",
  },
  {
    actual: () => {
      const extracted = extractArticleText(ARTICLE_SUBSET_PAGE);
      return `${summarize(readArticlePage(page(ARTICLE_SUBSET_PAGE)))} keptTextOutsideArticleElement=${extracted.includes(OUTSIDE_ARTICLE_MARKER)}`;
    },
    expected:
      "adapter=direct reason=none fallback=none floorMet=true keptTextOutsideArticleElement=true",
    name: "shape-article-subset-of-paragraphs",
  },
  {
    actual: () => {
      const extracted = extractArticleText(CHROME_HEAVY_PAGE);
      return `${summarize(readArticlePage(page(CHROME_HEAVY_PAGE)))} chromeIncluded=${extracted.includes(CHROME_LABEL)}`;
    },
    expected:
      "adapter=direct reason=none fallback=none floorMet=true chromeIncluded=false",
    name: "chrome-paragraphs-dropped",
  },
  {
    actual: () =>
      summarize(
        readArticlePage(
          page(CHALLENGE_PAGE, {
            headers: { "cf-mitigated": "challenge" },
            status: 403,
          }),
        ),
      ),
    expected:
      "adapter=none reason=anti_bot_challenge fallback=none floorMet=false",
    name: "challenge-403",
  },
  {
    actual: () => summarize(readArticlePage(page(THIN_PAGE))),
    expected:
      "adapter=none reason=extraction_insufficient fallback=none floorMet=false",
    name: "thin-page",
  },
  {
    actual: () => summarize(readArticlePage(page(JS_REQUIRED_PAGE))),
    expected: "adapter=none reason=js_required fallback=none floorMet=false",
    name: "js-required-page",
  },
  {
    actual: async () =>
      summarize(
        await fetchArticle(
          request({
            feedContent: FEED_BODY,
            url: "https://article.example.invalid/posts/one",
          }),
          {},
        ),
      ),
    expected: "adapter=feed reason=none fallback=none floorMet=true",
    name: "feed-content-sufficient",
  },
  {
    actual: async () =>
      summarize(
        await fetchArticle(
          request({
            endpointOrigin: "https://article.example.invalid",
            feedContent: BODY_SENTENCE,
            url: "https://article.example.invalid/posts/one",
          }),
          {},
        ),
      ),
    expected: "adapter=none reason=fetch_failed fallback=none floorMet=false",
    name: "feed-content-below-threshold-falls-through",
  },
  {
    actual: async () =>
      summarize(
        await fetchArticle(
          request({ url: "https://other.example.test/posts/one" }),
          {},
        ),
      ),
    expected: "adapter=none reason=off_origin fallback=none floorMet=false",
    name: "off-origin-skipped",
  },
  {
    actual: async () =>
      summarize(
        await fetchArticle(
          request({
            endpointOrigin: "http://127.0.0.1",
            mode: "direct_then_firecrawl",
            url: "http://127.0.0.1/posts/one",
          }),
          REACHABLE_FIRECRAWL,
        ),
      ),
    expected: "adapter=none reason=ssrf_blocked fallback=none floorMet=false",
    name: "ssrf-blocked-never-falls-back",
  },
  {
    actual: async () =>
      summarize(
        await fetchArticle(
          request({
            endpointOrigin: "http://127.0.0.1",
            mode: "firecrawl",
            url: "http://127.0.0.1/posts/one",
          }),
          REACHABLE_FIRECRAWL,
        ),
      ),
    expected: "adapter=none reason=ssrf_blocked fallback=none floorMet=false",
    name: "ssrf-blocked-firecrawl-mode",
  },
  {
    actual: async () =>
      summarize(
        await fetchArticle(
          request({
            endpointOrigin: "https://article.example.invalid",
            mode: "direct_then_firecrawl",
            url: "https://article.example.invalid/posts/one",
          }),
          {},
        ),
      ),
    expected: "adapter=none reason=fetch_failed fallback=none floorMet=false",
    name: "fetch-failed-never-falls-back",
  },
  {
    actual: async () =>
      summarize(await fetchArticle(request({ mode: "firecrawl" }), {})),
    expected: "threw durable event transport missing firecrawl",
    name: "firecrawl-mode-requires-binding",
  },
];

export async function runArticleFixtures(only?: string) {
  const selected = FIXTURES.filter(
    (fixture) => only === undefined || fixture.name === only,
  );
  if (selected.length === 0) {
    console.log(`unknown extract fixture ${only}`);
    return false;
  }

  let passed = true;
  console.log(
    `extract floor=${EXTRACT_FLOOR_CHARS} feedSufficient=${FEED_CONTENT_SUFFICIENT_CHARS}`,
  );

  for (const fixture of selected) {
    let actual: string;
    try {
      actual = await fixture.actual();
    } catch (error) {
      actual = `threw ${error instanceof Error ? error.message : "UNKNOWN"}`;
    }
    const ok = actual === fixture.expected;
    passed &&= ok;
    console.log(`${ok ? "PASS" : "FAIL"} extract ${fixture.name}`);
    console.log(`  actual   ${actual}`);
    if (!ok) {
      console.log(`  expected ${fixture.expected}`);
    }
  }

  return passed;
}

function page(
  body: string,
  init: { headers?: Record<string, string>; status?: number } = {},
): SafeHttpResponse {
  return {
    decodedBytes: Buffer.byteLength(body),
    headers: new Headers(init.headers),
    status: init.status ?? 200,
    text: body,
    url: ARTICLE_URL,
  };
}

function summarize(result: ArticleFetchResult) {
  if (result.adapter === null) {
    return `adapter=none reason=${result.reason} fallback=none floorMet=false`;
  }
  return [
    `adapter=${result.adapter}`,
    "reason=none",
    `fallback=${result.fallbackReason ?? "none"}`,
    `floorMet=${result.text.length >= EXTRACT_FLOOR_CHARS}`,
  ].join(" ");
}
