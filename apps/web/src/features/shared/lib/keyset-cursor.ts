import { z } from "zod";

export const keysetCursorParam = z
  .string()
  .min(1)
  .max(512)
  .nullable()
  .catch(null);

export const occurredAtCursorSchema = z.strictObject({
  direction: z.enum(["older", "newer"]),
  occurredAt: z.iso.datetime(),
  id: z.uuid(),
});
export type OccurredAtCursor = z.infer<typeof occurredAtCursorSchema>;

export const createdAtCursorSchema = z.strictObject({
  direction: z.enum(["older", "newer"]),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});
export type CreatedAtCursor = z.infer<typeof createdAtCursorSchema>;

export type KeysetPage<TRow> = {
  rows: TRow[];
  olderCursor: string | null;
  newerCursor: string | null;
  offLatest: boolean;
};

export function encodeKeysetCursor<TCursor extends { direction: string }>(
  payload: TCursor,
) {
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

export function keysetPageOf<
  TRow,
  TCursor extends { direction: "older" | "newer" },
>({
  raw,
  pageSize,
  cursor,
  toCursor,
}: {
  raw: TRow[];
  pageSize: number;
  cursor: { direction: "older" | "newer" } | null;
  toCursor: (row: TRow, direction: "older" | "newer") => TCursor;
}) {
  const direction = cursor?.direction ?? "older";
  const hasExtra = raw.length > pageSize;
  const bounded = raw.slice(0, pageSize);
  const ordered = direction === "newer" ? bounded.toReversed() : bounded;
  const first = ordered[0];
  const last = ordered.at(-1);
  return {
    ordered,
    olderCursor:
      last && (direction === "newer" || hasExtra)
        ? encodeKeysetCursor(toCursor(last, "older"))
        : null,
    newerCursor:
      first && cursor && (direction === "older" || hasExtra)
        ? encodeKeysetCursor(toCursor(first, "newer"))
        : null,
    offLatest: cursor !== null,
  };
}
