import type {
  ArticleAdapter,
  ArticleFetchMode,
  EnrichmentReason,
} from "@rz-chain-reporter/contracts";

export type ArticleBindings = {
  FIRECRAWL_API_KEY?: string;
};

export type ArticleFetchRequest = {
  endpointOrigin: string;
  feedContent: string | null;
  mode: ArticleFetchMode;
  timeoutMs: number;
  url: string;
};

export type ArticleFetchResult =
  | {
      adapter: ArticleAdapter;
      fallbackReason: EnrichmentReason | null;
      text: string;
    }
  | { adapter: null; reason: EnrichmentReason };

export type ArticleFetcher = (
  request: ArticleFetchRequest,
  bindings: ArticleBindings,
) => Promise<ArticleFetchResult>;

export const EXTRACT_MAX_CHARS = 8_000;
// Between the largest measured challenge page (575) and the thinnest real article (1819).
export const EXTRACT_FLOOR_CHARS = 1_000;
export const FEED_CONTENT_SUFFICIENT_CHARS = 1_500;

// Article origin is the source endpoint origin: no other host, no non-standard port, no credentials.
export function sameArticleOrigin(url: string, endpointOrigin: string) {
  try {
    const target = new URL(url);
    return (
      target.origin === endpointOrigin &&
      target.username === "" &&
      target.password === ""
    );
  } catch {
    return false;
  }
}
