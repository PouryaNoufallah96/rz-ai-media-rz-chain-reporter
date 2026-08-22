import { fetchRssAtomSource } from "./rss-atom";
import { fetchTelegramSource } from "./telegram-public";
import type { SourceFetchRequest, SourceFetchResult } from "./types";

export async function fetchSource(
  request: SourceFetchRequest,
): Promise<SourceFetchResult> {
  switch (request.origin) {
    case "rss":
      return await fetchRssAtomSource(request);
    case "telegram_public":
      return await fetchTelegramSource(request);
  }
}
