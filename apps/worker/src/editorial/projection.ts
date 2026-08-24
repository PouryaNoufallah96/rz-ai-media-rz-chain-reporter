import { normalizeText } from "./text";

export const PROJECTION_VERSION = "1";

export function buildProjection(
  revision: { title: string; summary: string | null },
  maxChars: number,
): string {
  const title = normalizeText(revision.title);
  const body = revision.summary === null ? "" : normalizeText(revision.summary);
  const projection = body.length === 0 ? title : `${title} ${body}`;
  const characters = Array.from(projection);

  return characters.length <= maxChars
    ? projection
    : characters.slice(0, maxChars).join("");
}
