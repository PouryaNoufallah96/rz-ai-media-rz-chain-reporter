import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type MessageFormatElement,
  parse,
  TYPE,
} from "@formatjs/icu-messageformat-parser";
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

function readSignature(
  elements: MessageFormatElement[],
  signature: Map<string, string>,
): void {
  for (const element of elements) {
    switch (element.type) {
      case TYPE.argument:
        signature.set(element.value, `{${element.value}}`);
        break;
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        signature.set(
          element.value,
          `{${element.value}, ${TYPE[element.type]}, ${JSON.stringify(element.style ?? "")}}`,
        );
        break;
      case TYPE.plural:
      case TYPE.select: {
        const kind =
          element.type === TYPE.select ? "select" : element.pluralType;

        signature.set(
          element.value,
          `{${element.value}, ${kind}, ${Object.keys(element.options).sort().join(" ")}}`,
        );

        for (const option of Object.values(element.options))
          readSignature(option.value, signature);

        break;
      }
      case TYPE.tag:
        signature.set(`<${element.value}>`, `<${element.value}>`);
        readSignature(element.children, signature);
        break;
      default:
        break;
    }
  }
}

function signatureOf(
  message: string,
  label: string,
  problems: string[],
): string | null {
  const signature = new Map<string, string>();

  try {
    readSignature(parse(message), signature);
  } catch (error) {
    problems.push(
      `${label} is not valid ICU: ${error instanceof Error ? error.message : String(error)}`,
    );

    return null;
  }

  return [...signature.values()].sort().join(" ");
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

      const expected = signatureOf(
        message,
        `${DEFAULT_LOCALE} ${key}`,
        problems,
      );
      const translatedSignature = signatureOf(
        translated,
        `${locale} ${key}`,
        problems,
      );

      if (expected === null || translatedSignature === null) continue;

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
