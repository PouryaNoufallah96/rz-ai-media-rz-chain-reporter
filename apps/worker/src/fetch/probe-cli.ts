import { fetchArticle } from "../articles/fetcher";
import { runArticleFixtures } from "../articles/fixtures";
import { runSourceFixtures } from "../sources/fixtures";
import { probeFetchWithExemptions, SafeHttpError } from "./safe-http";

const EXIT_FAILURE = 1;
const PROBE_MAX_DECODED_BYTES = 65_536;
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_MIME_ALLOWLIST = [
  "application/atom+xml",
  "application/rss+xml",
  "application/xml",
  "text/html",
  "text/plain",
  "text/xml",
];

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "ssrf":
      await probeSsrf(args);
      break;
    case "parse-feed":
      process.exitCode = runSourceFixtures(args[0]) ? 0 : EXIT_FAILURE;
      break;
    case "firecrawl":
      await probeFirecrawl(args);
      break;
    case "extract":
      process.exitCode = (await runArticleFixtures(args[0])) ? 0 : EXIT_FAILURE;
      break;
    default:
      failUsage();
  }
} catch (error) {
  process.exitCode = EXIT_FAILURE;
  console.error(
    `probe failed [${error instanceof Error ? error.message : "UNKNOWN"}]`,
  );
}

async function probeFirecrawl(args: string[]) {
  const [url, mode = "firecrawl"] = args;
  if (
    url === undefined ||
    (mode !== "direct" &&
      mode !== "direct_then_firecrawl" &&
      mode !== "firecrawl")
  ) {
    failUsage();
  }

  const { workerEnv } = await import("../runtime/env");
  console.log(
    `firecrawl target=${url} mode=${mode} bound=${workerEnv.FIRECRAWL_API_KEY !== undefined}`,
  );
  const article = await fetchArticle(
    {
      endpointOrigin: new URL(url).origin,
      feedContent: null,
      mode,
      timeoutMs: PROBE_TIMEOUT_MS,
      url,
    },
    { FIRECRAWL_API_KEY: workerEnv.FIRECRAWL_API_KEY },
  );

  if (article.adapter === null) {
    process.exitCode = EXIT_FAILURE;
    console.log(`firecrawl outcome=refused reason=${article.reason}`);
    return;
  }
  console.log(
    `firecrawl outcome=fetched adapter=${article.adapter} fallbackReason=${article.fallbackReason ?? "none"} chars=${article.text.length}`,
  );
}

async function probeSsrf(args: string[]) {
  const exemptOrigins: string[] = [];
  const rest = [...args];
  let url: string | undefined;

  while (rest.length > 0) {
    const value = rest.shift();
    if (value === undefined) {
      break;
    }
    if (value === "--allow") {
      const origin = rest.shift();
      if (origin === undefined) {
        failUsage();
      }
      exemptOrigins.push(new URL(origin).origin);
    } else if (url === undefined) {
      url = value;
    } else {
      failUsage();
    }
  }
  if (url === undefined) {
    failUsage();
  }

  console.log(`ssrf target=${url} allow=${exemptOrigins.join(",") || "none"}`);
  try {
    const response = await probeFetchWithExemptions(
      {
        maxDecodedBytes: PROBE_MAX_DECODED_BYTES,
        mimeAllowlist: PROBE_MIME_ALLOWLIST,
        timeoutMs: PROBE_TIMEOUT_MS,
        url,
      },
      exemptOrigins,
    );
    console.log(
      `ssrf outcome=fetched status=${response.status} finalUrl=${response.url} decodedBytes=${response.decodedBytes} etag=${response.headers.get("etag") ?? "none"}`,
    );
  } catch (error) {
    if (!(error instanceof SafeHttpError)) {
      throw error;
    }
    process.exitCode = EXIT_FAILURE;
    console.log(
      `ssrf outcome=refused reason=${error.reason} host=${error.host} retryAfterSeconds=${error.retryAfterSeconds ?? "none"}`,
    );
  }
}

function failUsage(): never {
  throw new Error(
    "USAGE: ssrf <url> [--allow <origin>]... | firecrawl <url> [mode] | parse-feed [fixture] | extract [fixture]",
  );
}
