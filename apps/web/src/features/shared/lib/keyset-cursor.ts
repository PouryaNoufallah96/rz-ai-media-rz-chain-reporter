import type { z } from "zod";

export function encodeKeysetCursor(payload: object) {
  return btoa(JSON.stringify(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodeKeysetCursor<TCursor>(
  schema: z.ZodType<TCursor>,
  value: string | null,
) {
  if (value === null) return null;

  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    return schema.parse(JSON.parse(atob(base64 + padding)));
  } catch {
    return null;
  }
}
