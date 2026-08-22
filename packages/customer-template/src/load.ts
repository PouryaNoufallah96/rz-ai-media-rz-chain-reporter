import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

import {
  type CustomerTemplateReference,
  computeCustomerTemplateFingerprint,
} from "./fingerprint";
import { imageProfileSchema } from "./image-profile";
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
  "REFERENCE_NOT_FOUND",
  "REFERENCE_ESCAPES_ROOT",
  "IMAGE_PROFILE_INVALID",
  "UNDECLARED_FILE",
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
  references: readonly CustomerTemplateReference[];
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
  const customerDir = resolve(templatesDir, key);
  const templatePath = resolve(customerDir, TEMPLATE_FILE);
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

  const contents = readFileSync(
    /* turbopackIgnore: true */ realTemplatePath,
    "utf8",
  );
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

  const references = resolveReferences(customerDir, validated.data);

  assertNoUndeclaredFiles(customerDir, references);

  return {
    template: validated.data,
    references,
    fingerprint: computeCustomerTemplateFingerprint({
      template: validated.data,
      references,
    }),
  };
}

function resolveReferences(
  customerDir: string,
  template: CustomerTemplate,
): CustomerTemplateReference[] {
  const declared = template.mediaBrands.flatMap((brand) => [
    ...(brand.brandBible ? [{ path: brand.brandBible, profile: false }] : []),
    ...(brand.imageProfile
      ? [{ path: brand.imageProfile, profile: true }]
      : []),
  ]);

  return declared
    .sort((left, right) => (left.path < right.path ? -1 : 1))
    .map(({ path, profile }) => {
      const bytes = readReference(customerDir, path);

      if (profile) {
        assertImageProfile(path, bytes);
      }

      return {
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    });
}

function readReference(customerDir: string, path: string) {
  const referencePath = resolve(customerDir, path);
  const realReferencePath = realPathOrNull(referencePath);

  if (realReferencePath === null) {
    throw new CustomerTemplateError(
      "REFERENCE_NOT_FOUND",
      `Customer template reference "${path}" is missing from ${customerDir}`,
    );
  }

  const realCustomerDir = realPathOrNull(customerDir);

  if (
    realCustomerDir === null ||
    !isInside(realCustomerDir, realReferencePath)
  ) {
    throw new CustomerTemplateError(
      "REFERENCE_ESCAPES_ROOT",
      `Customer template reference "${path}" resolves to ${realReferencePath}, outside ${customerDir}`,
    );
  }

  return readFileSync(/* turbopackIgnore: true */ realReferencePath);
}

function assertImageProfile(path: string, bytes: Buffer) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new CustomerTemplateError(
      "IMAGE_PROFILE_INVALID",
      `Image profile "${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const validated = imageProfileSchema.safeParse(parsed);

  if (!validated.success) {
    throw new CustomerTemplateError(
      "IMAGE_PROFILE_INVALID",
      `Image profile "${path}" is not a valid image profile:\n${z.prettifyError(validated.error)}`,
    );
  }
}

// Packaging globs cannot compute the declared set; the loader refuses undeclared files.
function assertNoUndeclaredFiles(
  customerDir: string,
  references: readonly CustomerTemplateReference[],
) {
  const declared = new Set([TEMPLATE_FILE, ...references.map((r) => r.path)]);

  for (const found of listFiles(customerDir, "")) {
    if (!declared.has(found)) {
      throw new CustomerTemplateError(
        "UNDECLARED_FILE",
        `${customerDir} holds "${found}", which no template field declares`,
      );
    }
  }
}

function listFiles(customerDir: string, prefix: string): string[] {
  const entries = readdirSync(resolve(customerDir, prefix), {
    withFileTypes: true,
  });

  return entries.flatMap((entry) => {
    if (entry.name.startsWith(".")) {
      return [];
    }

    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

    return entry.isDirectory() ? listFiles(customerDir, path) : [path];
  });
}
