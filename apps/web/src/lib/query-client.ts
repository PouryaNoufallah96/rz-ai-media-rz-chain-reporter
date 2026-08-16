import { QueryClient } from "@tanstack/react-query";
import { cache } from "react";

const STALE_TIME_MS = 60_000;

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: STALE_TIME_MS },
    },
  });
}

// `cache()` is a Server Component API — call it only on the server branch.
let serverQueryClient: (() => QueryClient) | undefined;
let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (typeof window === "undefined") {
    serverQueryClient ??= cache(makeQueryClient);
    return serverQueryClient();
  }

  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
