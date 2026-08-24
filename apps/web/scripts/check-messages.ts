import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFAULT_LOCALE, LOCALES } from "@rz-chain-reporter/i18n";

const EXIT_FAILURE = 1;

const command = "i18n:check";
const featuresPath = fileURLToPath(
  new URL("../src/features/", import.meta.url),
);

type Catalog = { [segment: string]: string | Catalog };

function readMessages(slice: string, locale: string): Map<string, string> {
  const catalog: Catalog = JSON.parse(
    readFileSync(`${featuresPath}${slice}/messages/${locale}.json`, "utf8"),
  );
  const messages = new Map<string, string>();

  flatten(catalog, "", messages);

  return messages;
}

function flatten(
  catalog: Catalog,
  prefix: string,
  messages: Map<string, string>,
): void {
  for (const [segment, value] of Object.entries(catalog)) {
    const key = prefix === "" ? segment : `${prefix}.${segment}`;

    if (typeof value === "string") messages.set(key, value);
    else flatten(value, key, messages);
  }
}

// ICU quotes only before `{`, `}` and `#`; `''` is a literal apostrophe and a
// lone `'` anywhere else is ordinary text.
function skipQuote(message: string, start: number): number {
  const next = message[start + 1];

  if (next === "'") return start + 2;
  if (next !== "{" && next !== "}" && next !== "#") return start + 1;

  const end = message.indexOf("'", start + 2);

  return end === -1 ? message.length : end + 1;
}

function readBraces(
  message: string,
  start: number,
): { body: string; end: number } {
  let depth = 0;
  let index = start;

  while (index < message.length) {
    const char = message[index];

    if (char === "'") {
      index = skipQuote(message, index);
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0)
        return { body: message.slice(start + 1, index), end: index + 1 };
    }

    index += 1;
  }

  return { body: message.slice(start + 1), end: message.length };
}

function splitArgument(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  let index = 0;

  while (index < body.length) {
    const char = body[index];

    if (char === "'") {
      index = skipQuote(body, index);
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (char === "," && depth === 0 && parts.length < 2) {
      parts.push(body.slice(from, index));
      from = index + 1;
    }

    index += 1;
  }

  parts.push(body.slice(from));

  return parts.map((part) => part.trim());
}

function readBranches(options: string, signature: Map<string, string>): string {
  const branches: string[] = [];
  let index = 0;
  let from = 0;

  while (index < options.length) {
    if (options[index] !== "{") {
      index += 1;
      continue;
    }

    branches.push(options.slice(from, index).trim());

    const { body, end } = readBraces(options, index);

    readSignature(body, signature);
    index = end;
    from = end;
  }

  return branches.join(" ");
}

function readSignature(message: string, signature: Map<string, string>): void {
  let index = 0;

  while (index < message.length) {
    const char = message[index];

    if (char === "'") {
      index = skipQuote(message, index);
      continue;
    }
    if (char !== "{") {
      index += 1;
      continue;
    }

    const { body, end } = readBraces(message, index);
    const [name = "", type = "", options = ""] = splitArgument(body);

    signature.set(
      name,
      type === "plural" || type === "selectordinal" || type === "select"
        ? `${type} ${readBranches(options, signature)}`
        : `${type} ${options}`.trim(),
    );
    index = end;
  }
}

function signatureOf(message: string): string {
  const signature = new Map<string, string>();

  readSignature(message, signature);

  return [...signature]
    .map(([name, type]) => `{${type === "" ? name : `${name}, ${type}`}}`)
    .sort()
    .join(" ");
}

const slices = readdirSync(featuresPath, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(`${featuresPath}${entry.name}/messages`),
  )
  .map((entry) => entry.name);

const problems: string[] = [];

for (const slice of slices) {
  const reference = readMessages(slice, DEFAULT_LOCALE);

  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;

    const messages = readMessages(slice, locale);

    for (const [key, message] of reference) {
      const translated = messages.get(key);

      if (translated === undefined) {
        problems.push(`${locale} is missing ${key}`);
        continue;
      }

      const expected = signatureOf(message);
      const translatedSignature = signatureOf(translated);

      if (expected !== translatedSignature) {
        problems.push(
          `${key} takes ${expected || "no arguments"} in ${DEFAULT_LOCALE} but ${translatedSignature || "no arguments"} in ${locale}`,
        );
      }
    }

    for (const key of messages.keys()) {
      if (!reference.has(key))
        problems.push(`${locale} has ${key}, which ${DEFAULT_LOCALE} does not`);
    }
  }

  console.log(`${command} ${slice} ${reference.size} keys`);
}

if (problems.length > 0) {
  for (const problem of problems)
    console.error(`${command} failed: ${problem}`);

  process.exit(EXIT_FAILURE);
}

console.log(
  `${command} ${LOCALES.join("/")} key-set and ICU signature parity ok`,
);
