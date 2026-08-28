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
  type ReviewedKnowledgeFaqRow,
  type ReviewedKnowledgeLocale,
  reviewedKnowledgeFaqSchema,
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
  "BRAND_LOGO_INVALID",
  "REVIEWED_KNOWLEDGE_INVALID",
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

// No repository path: a citation must never expose the artifact layout.
export type ReviewedKnowledgeDocument = {
  id: string;
  kind: "workspace-overview" | "brand-chat";
  brandKey: string | null;
  locale: ReviewedKnowledgeLocale;
  sha256: string;
  text: string;
};

export type BrandBibleDocument = {
  brandKey: string;
  sha256: string;
  text: string;
};

export type LoadedReviewedKnowledge = {
  faqByLocale: Partial<
    Record<ReviewedKnowledgeLocale, readonly ReviewedKnowledgeFaqRow[]>
  >;
  documents: readonly ReviewedKnowledgeDocument[];
  brandBibles: readonly BrandBibleDocument[];
};

export type LoadedCustomerTemplate = {
  template: CustomerTemplate;
  references: readonly CustomerTemplateReference[];
  reviewedKnowledge: LoadedReviewedKnowledge;
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

  const admitted = readDeclaredReferences(customerDir, validated.data);
  const references = admitted.map(({ path, sha256 }) => ({ path, sha256 }));

  assertNoUndeclaredFiles(customerDir, references);

  return {
    template: validated.data,
    references,
    reviewedKnowledge: buildReviewedKnowledge(validated.data, admitted),
    fingerprint: computeCustomerTemplateFingerprint({
      template: validated.data,
      references,
    }),
  };
}

type AdmittedReference = CustomerTemplateReference & { bytes: Buffer };

function reviewedKnowledgeReferences(template: CustomerTemplate) {
  const reviewed = template.reviewedKnowledge;

  if (!reviewed) {
    return [];
  }

  return [
    ...Object.values(reviewed.faq ?? {}).map((path) => ({
      kind: "reviewed-faq" as const,
      path,
    })),
    ...Object.values(reviewed.workspaceOverview ?? {}).map((path) => ({
      kind: "reviewed-document" as const,
      path,
    })),
    ...Object.values(reviewed.brandChat ?? {}).flatMap((byLocale) =>
      Object.values(byLocale ?? {}).map((path) => ({
        kind: "reviewed-document" as const,
        path,
      })),
    ),
  ];
}

function buildReviewedKnowledge(
  template: CustomerTemplate,
  admitted: readonly AdmittedReference[],
): LoadedReviewedKnowledge {
  const byPath = new Map(admitted.map((entry) => [entry.path, entry]));
  const brandBibles = template.mediaBrands.flatMap((brand) => {
    const entry = brand.brandBible ? byPath.get(brand.brandBible) : undefined;

    return entry
      ? [
          {
            brandKey: brand.key,
            sha256: entry.sha256,
            text: entry.bytes.toString("utf8"),
          },
        ]
      : [];
  });
  const reviewed = template.reviewedKnowledge;

  if (!reviewed) {
    return { faqByLocale: {}, documents: [], brandBibles };
  }

  const read = (path: string) => {
    const entry = byPath.get(path);

    if (!entry) {
      throw new CustomerTemplateError(
        "REFERENCE_NOT_FOUND",
        `Reviewed Knowledge reference "${path}" was not admitted`,
      );
    }

    return entry;
  };

  const faqByLocale: LoadedReviewedKnowledge["faqByLocale"] = {};

  for (const [locale, path] of localeEntries(reviewed.faq)) {
    faqByLocale[locale] = parseReviewedFaq(path, read(path).bytes);
  }

  const documents = [
    ...localeEntries(reviewed.workspaceOverview).map(([locale, path]) => ({
      id: "workspace-overview",
      kind: "workspace-overview" as const,
      brandKey: null,
      locale,
      sha256: read(path).sha256,
      text: read(path).bytes.toString("utf8"),
    })),
    ...Object.entries(reviewed.brandChat ?? {}).flatMap(
      ([brandKey, byLocale]) =>
        localeEntries(byLocale).map(([locale, path]) => ({
          id: `brand:${brandKey}`,
          kind: "brand-chat" as const,
          brandKey,
          locale,
          sha256: read(path).sha256,
          text: read(path).bytes.toString("utf8"),
        })),
    ),
  ];

  return { faqByLocale, documents, brandBibles };
}

function localeEntries(
  byLocale: Partial<Record<ReviewedKnowledgeLocale, string>> | undefined,
) {
  return Object.entries(byLocale ?? {}) as [ReviewedKnowledgeLocale, string][];
}

function parseReviewedFaq(path: string, bytes: Buffer) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new CustomerTemplateError(
      "REVIEWED_KNOWLEDGE_INVALID",
      `Reviewed FAQ "${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const validated = reviewedKnowledgeFaqSchema.safeParse(parsed);

  if (!validated.success) {
    throw new CustomerTemplateError(
      "REVIEWED_KNOWLEDGE_INVALID",
      `Reviewed FAQ "${path}" is not a valid reviewed FAQ:\n${z.prettifyError(validated.error)}`,
    );
  }

  const keys = new Set<string>();

  for (const row of validated.data) {
    if (keys.has(row.key)) {
      throw new CustomerTemplateError(
        "REVIEWED_KNOWLEDGE_INVALID",
        `Reviewed FAQ "${path}" repeats key "${row.key}"`,
      );
    }

    keys.add(row.key);
  }

  return validated.data satisfies readonly ReviewedKnowledgeFaqRow[];
}

function readDeclaredReferences(
  customerDir: string,
  template: CustomerTemplate,
): AdmittedReference[] {
  const declared = [
    ...reviewedKnowledgeReferences(template),
    ...template.mediaBrands.flatMap((brand) => [
      ...(brand.brandBible
        ? [{ kind: "document" as const, path: brand.brandBible }]
        : []),
      ...(brand.imageProfile
        ? [{ kind: "image-profile" as const, path: brand.imageProfile }]
        : []),
      ...(brand.brandLogo
        ? [
            {
              kind: "brand-logo" as const,
              path: brand.brandLogo.path,
              metadata: brand.brandLogo,
            },
          ]
        : []),
    ]),
  ];

  return declared
    .sort((left, right) => (left.path < right.path ? -1 : 1))
    .map((reference) => {
      const bytes = readReference(customerDir, reference.path);

      if (reference.kind === "image-profile") {
        assertImageProfile(reference.path, bytes);
      } else if (reference.kind === "brand-logo") {
        assertBrandLogo(reference.path, bytes, reference.metadata);
      }

      return {
        bytes,
        path: reference.path,
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

function assertBrandLogo(
  path: string,
  bytes: Buffer,
  metadata: NonNullable<CustomerTemplate["mediaBrands"][number]["brandLogo"]>,
) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const isPng =
    bytes.length >= 24 &&
    bytes.subarray(0, pngSignature.length).equals(pngSignature) &&
    bytes.subarray(12, 16).toString("ascii") === "IHDR";

  if (!isPng) {
    throw new CustomerTemplateError(
      "BRAND_LOGO_INVALID",
      `Brand logo "${path}" does not decode as ${metadata.mimeType}`,
    );
  }

  const actual = {
    pixelWidth: bytes.readUInt32BE(16),
    pixelHeight: bytes.readUInt32BE(20),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };

  if (
    actual.pixelWidth !== metadata.pixelWidth ||
    actual.pixelHeight !== metadata.pixelHeight ||
    actual.sha256 !== metadata.sha256
  ) {
    throw new CustomerTemplateError(
      "BRAND_LOGO_INVALID",
      `Brand logo "${path}" does not match its declared dimensions and checksum`,
    );
  }
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
