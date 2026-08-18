import { createHash } from "node:crypto";

import type { CustomerTemplate } from "./schema";

// Object keys sorted, authored array order preserved; reformatting the JSON does not move the hash.
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1));

  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${canonicalize(entryValue)}`,
    )
    .join(",")}}`;
}

export function computeCustomerTemplateFingerprint(
  template: CustomerTemplate,
): string {
  return createHash("sha256")
    .update(canonicalize(template), "utf8")
    .digest("hex");
}
