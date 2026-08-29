import { lookup as resolveDns } from "node:dns";
import type { LookupFunction } from "node:net";
import { BlockList, isIP } from "node:net";
import { Agent, fetch, type Headers } from "undici";

import { workerLogger } from "../logging/logger";

export type SafeHttpFailure =
  | "deadline"
  | "fetch_failed"
  | "redirect_blocked"
  | "retry_after"
  | "ssrf_blocked"
  | "too_large"
  | "unsupported_mime";

export class SafeHttpError extends Error {
  readonly host: string;
  readonly reason: SafeHttpFailure;
  readonly retryAfterSeconds: number | null;

  constructor(
    reason: SafeHttpFailure,
    host: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(reason);
    this.name = "SafeHttpError";
    this.host = host;
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type SafeHttpRequest = {
  headers?: Record<string, string>;
  maxDecodedBytes: number;
  mimeAllowlist: readonly string[];
  timeoutMs: number;
  url: string;
};

export type SafeHttpResponse = {
  decodedBytes: number;
  headers: Headers;
  status: number;
  text: string;
  url: string;
};

const MAX_REDIRECTS = 5;
const MAX_HEADER_BYTES = 16_384;
const CONNECT_TIMEOUT_MS = 5_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRY_AFTER_STATUSES = new Set([429, 503]);
const DEADLINE_ERROR_NAMES = new Set([
  "AbortError",
  "BodyTimeoutError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "TimeoutError",
]);

const BLOCKED_IPV4_SUBNETS: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const BLOCKED_IPV6_SUBNETS: readonly (readonly [string, number])[] = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const BLOCKED_ADDRESSES = new BlockList();
for (const [network, prefix] of BLOCKED_IPV4_SUBNETS) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of BLOCKED_IPV6_SUBNETS) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

const NO_EXEMPTIONS = new Set<string>();

export async function safeFetch(
  request: SafeHttpRequest,
): Promise<SafeHttpResponse> {
  return await attempt(request, NO_EXEMPTIONS);
}

// Probe-only: production `safeFetch` has no SSRF exemption.
export async function probeFetchWithExemptions(
  request: SafeHttpRequest,
  exemptOrigins: readonly string[],
): Promise<SafeHttpResponse> {
  return await attempt(request, new Set(exemptOrigins));
}

export async function isAllowedUntrustedUrl(url: string): Promise<boolean> {
  const target = parseUrl(url);
  if (target === null || !isAllowedUrl(target, NO_EXEMPTIONS)) {
    return false;
  }

  const host = hostOf(target);
  if (isIP(host) !== 0) {
    return true;
  }

  return await new Promise((resolve) => {
    resolveDns(host, { all: true }, (error, addresses) => {
      resolve(
        error === null &&
          addresses.length > 0 &&
          !addresses.some((entry) => isBlockedAddress(entry.address)),
      );
    });
  });
}

async function attempt(
  request: SafeHttpRequest,
  exemptOrigins: ReadonlySet<string>,
): Promise<SafeHttpResponse> {
  try {
    return await dispatch(request, exemptOrigins);
  } catch (error) {
    const failure = asSafeHttpError(error, request.url);
    workerLogger.warn("worker.fetch.blocked", {
      host: failure.host,
      outcome: failure.reason,
    });
    throw failure;
  }
}

async function dispatch(
  request: SafeHttpRequest,
  exemptOrigins: ReadonlySet<string>,
): Promise<SafeHttpResponse> {
  const target = parseUrl(request.url);
  if (target === null || !isAllowedUrl(target, exemptOrigins)) {
    throw new SafeHttpError(
      "ssrf_blocked",
      target === null ? "" : hostOf(target),
    );
  }

  const exemptHosts = new Set<string>();
  for (const origin of exemptOrigins) {
    const parsed = parseUrl(origin);
    if (parsed !== null) {
      exemptHosts.add(hostOf(parsed));
    }
  }

  const agent = new Agent({
    bodyTimeout: request.timeoutMs,
    connect: { lookup: pinnedLookup(exemptHosts), timeout: CONNECT_TIMEOUT_MS },
    headersTimeout: request.timeoutMs,
    maxHeaderSize: MAX_HEADER_BYTES,
    maxResponseSize: request.maxDecodedBytes,
  });
  const signal = AbortSignal.timeout(request.timeoutMs);
  let current = target;

  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetch(current, {
        dispatcher: agent,
        headers: request.headers,
        redirect: "manual",
        signal,
      });
      if (!REDIRECT_STATUSES.has(response.status)) {
        return await readResponse(request, current, response);
      }
      await response.body?.cancel();
      if (redirects === MAX_REDIRECTS) {
        break;
      }
      current = redirectTarget(
        current,
        response.headers.get("location"),
        exemptOrigins,
      );
    }
  } finally {
    await agent.destroy();
  }

  throw new SafeHttpError("redirect_blocked", hostOf(current));
}

function redirectTarget(
  current: URL,
  location: string | null,
  exemptOrigins: ReadonlySet<string>,
): URL {
  if (location === null) {
    throw new SafeHttpError("redirect_blocked", hostOf(current));
  }
  const next = parseUrl(location, current);
  if (
    next === null ||
    (current.protocol === "https:" && next.protocol !== "https:")
  ) {
    throw new SafeHttpError("redirect_blocked", hostOf(current));
  }
  if (!isAllowedUrl(next, exemptOrigins)) {
    throw new SafeHttpError("redirect_blocked", hostOf(next));
  }
  return next;
}

async function readResponse(
  request: SafeHttpRequest,
  url: URL,
  response: Awaited<ReturnType<typeof fetch>>,
): Promise<SafeHttpResponse> {
  const host = hostOf(url);
  const settled: SafeHttpResponse = {
    decodedBytes: 0,
    headers: response.headers,
    status: response.status,
    text: "",
    url: url.href,
  };

  if (RETRY_AFTER_STATUSES.has(response.status)) {
    await response.body?.cancel();
    throw new SafeHttpError(
      "retry_after",
      host,
      retryAfterSeconds(response.headers.get("retry-after")),
    );
  }
  if (response.status < 200 || response.status > 299) {
    await response.body?.cancel();
    return settled;
  }

  const [declaredMime, ...contentTypeParameters] = (
    response.headers.get("content-type") ?? ""
  ).split(";");
  const mime = declaredMime?.trim().toLowerCase();
  if (mime === undefined || !request.mimeAllowlist.includes(mime)) {
    await response.body?.cancel();
    throw new SafeHttpError("unsupported_mime", host);
  }
  if (
    Number(response.headers.get("content-length")) > request.maxDecodedBytes
  ) {
    await response.body?.cancel();
    throw new SafeHttpError("too_large", host);
  }

  const decoder = decoderFor(contentTypeParameters);
  if (decoder === null) {
    await response.body?.cancel();
    throw new SafeHttpError("unsupported_mime", host);
  }

  const reader = response.body?.getReader();
  if (reader === undefined) {
    return settled;
  }

  let decodedBytes = 0;
  let text = "";
  let chunk = await reader.read();
  while (chunk.done !== true) {
    decodedBytes += chunk.value.byteLength;
    if (decodedBytes > request.maxDecodedBytes) {
      await reader.cancel();
      throw new SafeHttpError("too_large", host);
    }
    text += decoder.decode(chunk.value, { stream: true });
    chunk = await reader.read();
  }

  return { ...settled, decodedBytes, text: text + decoder.decode() };
}

// The declared charset decodes as declared or the response is refused; a silent
// UTF-8 fallback would corrupt every legacy-encoded source instead.
function decoderFor(contentTypeParameters: readonly string[]) {
  try {
    return new TextDecoder(charsetOf(contentTypeParameters) ?? "utf-8");
  } catch {
    return null;
  }
}

function charsetOf(parameters: readonly string[]) {
  for (const parameter of parameters) {
    const [name, ...value] = parameter.split("=");
    if (name?.trim().toLowerCase() !== "charset") {
      continue;
    }
    const label = value.join("=").trim().replace(/^"|"$/g, "").toLowerCase();
    return label === "" ? null : label;
  }
  return null;
}

function pinnedLookup(exemptHosts: ReadonlySet<string>): LookupFunction {
  return (hostname, options, callback) => {
    resolveDns(hostname, { ...options, all: true }, (error, addresses) => {
      if (error !== null) {
        callback(error, []);
        return;
      }
      const [first] = addresses;
      if (first === undefined) {
        callback(new SafeHttpError("fetch_failed", hostname), []);
        return;
      }
      if (
        !exemptHosts.has(hostname) &&
        addresses.some((entry) => isBlockedAddress(entry.address))
      ) {
        callback(new SafeHttpError("ssrf_blocked", hostname), []);
        return;
      }
      if (options.all === true) {
        callback(null, addresses);
        return;
      }
      callback(null, first.address, first.family);
    });
  };
}

function isAllowedUrl(url: URL, exemptOrigins: ReadonlySet<string>) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  if (url.username !== "" || url.password !== "") {
    return false;
  }
  if (exemptOrigins.has(url.origin)) {
    return true;
  }
  if (url.port !== "") {
    return false;
  }
  const host = hostOf(url);
  return isIP(host) === 0 || !isBlockedAddress(host);
}

function isBlockedAddress(address: string) {
  const version = isIP(address);
  if (version === 0) {
    return true;
  }
  return BLOCKED_ADDRESSES.check(address, version === 4 ? "ipv4" : "ipv6");
}

function parseUrl(raw: string, base?: URL) {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

function hostOf(url: URL) {
  return url.hostname.startsWith("[")
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

function retryAfterSeconds(value: string | null) {
  if (value === null) {
    return null;
  }
  const seconds = Number(value.trim());
  if (Number.isInteger(seconds) && seconds >= 0) {
    return seconds;
  }
  const at = Date.parse(value);
  return Number.isNaN(at)
    ? null
    : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function asSafeHttpError(error: unknown, url: string) {
  const target = parseUrl(url);
  const host = target === null ? "" : hostOf(target);
  for (
    let cause: unknown = error;
    cause instanceof Error;
    cause = cause.cause
  ) {
    if (cause instanceof SafeHttpError) {
      return cause;
    }
    if (DEADLINE_ERROR_NAMES.has(cause.name)) {
      return new SafeHttpError("deadline", host);
    }
    if (cause.name === "ResponseExceededMaxSizeError") {
      return new SafeHttpError("too_large", host);
    }
  }
  return new SafeHttpError("fetch_failed", host);
}
