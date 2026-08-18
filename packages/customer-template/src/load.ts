import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

import { computeCustomerTemplateFingerprint } from "./fingerprint";
import {
  CUSTOMER_TEMPLATE_SCHEMA_VERSION,
  type CustomerTemplate,
  customerTemplateSchema,
} from "./schema";
import { stableKeySchema } from "./stable-key";

const CUSTOMER_TEMPLATE_ERROR_CODES = [
  "INVALID_KEY",
  "TEMPLATE_NOT_FOUND",
  "TEMPLATE_ESCAPES_ROOT",
  "INVALID_JSON",
  "UNSUPPORTED_SCHEMA_VERSION",
  "INVALID_TEMPLATE",
  "KEY_MISMATCH",
] as const;

export type CustomerTemplateErrorCode =
  (typeof CUSTOMER_TEMPLATE_ERROR_CODES)[number];

export class CustomerTemplateError extends Error {
  readonly code: CustomerTemplateErrorCode;

  constructor(code: CustomerTemplateErrorCode, message: string) {
    super(message);
    this.name = "CustomerTemplateError";
    this.code = code;
  }
}

export type LoadedCustomerTemplate = {
  template: CustomerTemplate;
  fingerprint: string;
};

const TEMPLATES_DIRECTORY = "customer-templates";
const TEMPLATE_FILE = "template.json";

const schemaVersionProbe = z.object({ schemaVersion: z.number().int() });

function isMissingPathError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function realPathOrNull(path: string) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }
}

function isInside(parent: string, child: string) {
  const step = relative(parent, child);

  return step !== "" && !step.startsWith("..") && !isAbsolute(step);
}

export function loadCustomerTemplate(
  rootDir: string,
  key: string,
): LoadedCustomerTemplate {
  if (!stableKeySchema.safeParse(key).success) {
    throw new CustomerTemplateError(
      "INVALID_KEY",
      `Customer template key ${JSON.stringify(key)} is not a lowercase hyphenated key`,
    );
  }

  const templatesDir = resolve(rootDir, TEMPLATES_DIRECTORY);
  const templatePath = resolve(templatesDir, key, TEMPLATE_FILE);
  const realTemplatePath = realPathOrNull(templatePath);

  if (realTemplatePath === null) {
    throw new CustomerTemplateError(
      "TEMPLATE_NOT_FOUND",
      `No customer template at ${templatePath}`,
    );
  }

  // Resolve every segment before reading so a symlink cannot escape the templates tree.
  const realTemplatesDir = realPathOrNull(templatesDir);

  if (
    realTemplatesDir === null ||
    !isInside(realTemplatesDir, realTemplatePath)
  ) {
    throw new CustomerTemplateError(
      "TEMPLATE_ESCAPES_ROOT",
      `Customer template ${templatePath} resolves to ${realTemplatePath}, outside ${templatesDir}`,
    );
  }

  const contents = readFileSync(realTemplatePath, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new CustomerTemplateError(
      "INVALID_JSON",
      `${templatePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const probe = schemaVersionProbe.safeParse(parsed);
  const declaredVersion = probe.success ? probe.data.schemaVersion : "none";

  if (declaredVersion !== CUSTOMER_TEMPLATE_SCHEMA_VERSION) {
    throw new CustomerTemplateError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `${templatePath} declares schemaVersion ${declaredVersion}; this loader supports ${CUSTOMER_TEMPLATE_SCHEMA_VERSION}`,
    );
  }

  const validated = customerTemplateSchema.safeParse(parsed);

  if (!validated.success) {
    throw new CustomerTemplateError(
      "INVALID_TEMPLATE",
      `${templatePath} is not a valid customer template:\n${z.prettifyError(validated.error)}`,
    );
  }

  if (validated.data.customer.key !== key) {
    throw new CustomerTemplateError(
      "KEY_MISMATCH",
      `${templatePath} declares customer key "${validated.data.customer.key}" but sits in directory "${key}"`,
    );
  }

  return {
    template: validated.data,
    fingerprint: computeCustomerTemplateFingerprint(validated.data),
  };
}
