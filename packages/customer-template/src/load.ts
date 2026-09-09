import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  IMAGE_SELECTION_PROMPT_RESERVE,
  IMAGE_SELECTION_SOURCE_MAX_CHARS,
  MODEL_PROMPT_MAX_LENGTH,
} from "@rz-chain-reporter/contracts/editorial";
import { z } from "zod";

import {
  type CustomerTemplateReference,
  computeCustomerTemplateFingerprint,
} from "./fingerprint";
import {
  type ImageProfile,
  imageProfileSchema,
  imageSelectionPromptPayload,
} from "./image-profile";
import {
  CUSTOMER_TEMPLATE_SCHEMA_VERSION,
  type CustomerTemplate,
  customerTemplateSchema,
  marketCompositionCatalogSchema,
  marketInstrumentProfileSchema,
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
  "BRAND_LOGO_GEOMETRY_INVALID",
  "MARKET_COMPOSITION_INVALID",
  "MARKET_INSTRUMENT_PROFILE_INVALID",
  "MARKET_RASTER_INVALID",
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
  faqSourceByLocale: Partial<
    Record<
      ReviewedKnowledgeLocale,
      { locale: ReviewedKnowledgeLocale; sha256: string; title: string }
    >
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
    return {
      faqByLocale: {},
      faqSourceByLocale: {},
      documents: [],
      brandBibles,
    };
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
  const faqSourceByLocale: LoadedReviewedKnowledge["faqSourceByLocale"] = {};

  for (const [locale, path] of localeEntries(reviewed.faq)) {
    const source = read(path);
    faqByLocale[locale] = parseReviewedFaq(path, source.bytes);
    faqSourceByLocale[locale] = {
      locale,
      sha256: source.sha256,
      title: `${template.customer.productName} reviewed FAQ`,
    };
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

  return { faqByLocale, faqSourceByLocale, documents, brandBibles };
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
  const market = template.marketAnalysis;
  const compositionCatalog = market.enabled
    ? parseSidecar(
        market.compositions,
        readReference(customerDir, market.compositions),
        marketCompositionCatalogSchema,
        "MARKET_COMPOSITION_INVALID",
        "Market composition catalog",
      )
    : null;
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
    ...(market.enabled
      ? [
          {
            kind: "market-composition" as const,
            path: market.compositions,
          },
          ...market.instruments.flatMap((instrument) => [
            {
              kind: "market-instrument-profile" as const,
              path: instrument.visualProfile,
            },
            {
              kind: "market-raster" as const,
              path: instrument.selectorIcon.path,
              metadata: instrument.selectorIcon,
            },
            {
              kind: "market-raster" as const,
              path: instrument.footerLockup.path,
              metadata: instrument.footerLockup,
            },
          ]),
          ...(compositionCatalog?.families.flatMap((family) =>
            family.variants.map((variant) => ({
              kind: "market-raster" as const,
              path: variant.sample.path,
              metadata: variant.sample,
            })),
          ) ?? []),
        ]
      : []),
  ];

  const profilesByPath = new Map<string, ImageProfile>();

  const references = declared
    .sort((left, right) => (left.path < right.path ? -1 : 1))
    .map((reference) => {
      const bytes = readReference(customerDir, reference.path);

      if (reference.kind === "image-profile") {
        profilesByPath.set(
          reference.path,
          assertImageProfile(reference.path, bytes),
        );
      } else if (reference.kind === "brand-logo") {
        assertStaticRaster(
          reference.path,
          bytes,
          reference.metadata,
          "BRAND_LOGO_INVALID",
          "Brand logo",
        );
      } else if (reference.kind === "market-raster") {
        assertStaticRaster(
          reference.path,
          bytes,
          reference.metadata,
          "MARKET_RASTER_INVALID",
          "Market raster",
        );
      } else if (reference.kind === "market-instrument-profile") {
        parseSidecar(
          reference.path,
          bytes,
          marketInstrumentProfileSchema,
          "MARKET_INSTRUMENT_PROFILE_INVALID",
          "Market instrument profile",
        );
      }

      return {
        bytes,
        path: reference.path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    });

  assertLogoGeometry(template, profilesByPath);

  return references;
}

// Mirrors the assembler: the resized logo plus its inset must land inside the canvas.
function assertLogoGeometry(
  template: CustomerTemplate,
  profilesByPath: ReadonlyMap<string, ImageProfile>,
) {
  for (const brand of template.mediaBrands) {
    const profile = brand.imageProfile
      ? profilesByPath.get(brand.imageProfile)
      : undefined;

    if (!profile || !brand.brandLogo) continue;

    const { height, width } = profile.output;
    const shortSide = Math.min(width, height);
    const logoWidth = Math.round(profile.logo.widthShortSideRatio * shortSide);
    const inset = Math.round(profile.logo.insetShortSideRatio * shortSide);
    const logoHeight = Math.round(
      (logoWidth * brand.brandLogo.pixelHeight) / brand.brandLogo.pixelWidth,
    );

    if (inset + logoWidth > width || inset + logoHeight > height) {
      throw new CustomerTemplateError(
        "BRAND_LOGO_GEOMETRY_INVALID",
        `Media brand "${brand.key}" places a ${logoWidth}x${logoHeight} logo at inset ${inset} on a ${width}x${height} canvas, which does not fit`,
      );
    }
  }
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

function assertStaticRaster(
  path: string,
  bytes: Buffer,
  metadata: {
    byteLength: number;
    mimeType: "image/png";
    pixelHeight: number;
    pixelWidth: number;
    sha256: string;
  },
  code: "BRAND_LOGO_INVALID" | "MARKET_RASTER_INVALID",
  label: string,
) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const isPng =
    bytes.length >= 24 &&
    bytes.subarray(0, pngSignature.length).equals(pngSignature) &&
    bytes.subarray(12, 16).toString("ascii") === "IHDR";

  if (!isPng) {
    throw new CustomerTemplateError(
      code,
      `${label} "${path}" does not decode as ${metadata.mimeType}`,
    );
  }

  const actual = {
    byteLength: bytes.length,
    pixelWidth: bytes.readUInt32BE(16),
    pixelHeight: bytes.readUInt32BE(20),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };

  if (
    actual.byteLength !== metadata.byteLength ||
    actual.pixelWidth !== metadata.pixelWidth ||
    actual.pixelHeight !== metadata.pixelHeight ||
    actual.sha256 !== metadata.sha256
  ) {
    throw new CustomerTemplateError(
      code,
      `${label} "${path}" does not match its declared bytes, dimensions, and checksum`,
    );
  }
}

function parseSidecar<T>(
  path: string,
  bytes: Buffer,
  schema: z.ZodType<T>,
  code: "MARKET_COMPOSITION_INVALID" | "MARKET_INSTRUMENT_PROFILE_INVALID",
  label: string,
) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new CustomerTemplateError(
      code,
      `${label} "${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const validated = schema.safeParse(parsed);

  if (!validated.success) {
    throw new CustomerTemplateError(
      code,
      `${label} "${path}" is invalid:\n${z.prettifyError(validated.error)}`,
    );
  }

  return validated.data;
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

  const budget =
    MODEL_PROMPT_MAX_LENGTH -
    IMAGE_SELECTION_PROMPT_RESERVE -
    IMAGE_SELECTION_SOURCE_MAX_CHARS;
  const payload = imageSelectionPromptPayload(validated.data).length;

  if (payload > budget) {
    throw new CustomerTemplateError(
      "IMAGE_PROFILE_INVALID",
      `Image profile "${path}" serialises to ${payload} characters of selection prompt, over the ${budget} the model gateway leaves for it`,
    );
  }

  return validated.data;
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
