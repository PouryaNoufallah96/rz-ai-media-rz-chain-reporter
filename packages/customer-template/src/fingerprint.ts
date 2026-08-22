import { createHash } from "node:crypto";

import type { CustomerTemplate } from "./schema";

export type CustomerTemplateReference = { path: string; sha256: string };

export type CustomerTemplateFingerprintInput = {
  template: CustomerTemplate;
  references: readonly CustomerTemplateReference[];
};

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
  input: CustomerTemplateFingerprintInput,
): string {
  return createHash("sha256").update(canonicalize(input), "utf8").digest("hex");
}
