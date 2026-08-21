import { z } from "zod";

const cursorPayloadSchema = z.object({
  direction: z.enum(["older", "newer"]),
  occurredAt: z.iso.datetime(),
  id: z.uuid(),
});

export type UsageCursor = z.infer<typeof cursorPayloadSchema>;

export function encodeUsageCursor(cursor: UsageCursor) {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodeUsageCursor(value: string | null) {
  if (value === null) return null;

  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    return cursorPayloadSchema.parse(JSON.parse(atob(base64 + padding)));
  } catch {
    return null;
  }
}
