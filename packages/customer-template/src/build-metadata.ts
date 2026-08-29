import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

import { CustomerTemplateError, loadCustomerTemplate } from "./load";

export const BUILD_METADATA_FILE = "build-metadata.json";

const EXIT_FAILURE = 1;

const buildMetadataSchema = z.strictObject({
  customerTemplateKey: z.string().min(1),
  schemaVersion: z.number().int(),
  fingerprint: z.string().length(64),
});

export type CustomerTemplateBuildMetadata = z.infer<typeof buildMetadataSchema>;

export class BuildMetadataError extends Error {
  readonly code = "BUILD_METADATA_UNREADABLE";

  constructor(message: string) {
    super(message);
    this.name = "BuildMetadataError";
  }
}

// Immutable build-time record; prestart trusts this fingerprint, not env.
export function writeBuildMetadata(
  path: string,
  metadata: CustomerTemplateBuildMetadata,
) {
  const { customerTemplateKey, schemaVersion, fingerprint } = metadata;

  writeFileSync(
    path,
    `${JSON.stringify({ customerTemplateKey, schemaVersion, fingerprint }, null, 2)}\n`,
    "utf8",
  );
}

export function readBuildMetadata(path: string): CustomerTemplateBuildMetadata {
  let contents: string;

  try {
    contents = readFileSync(path, "utf8");
  } catch {
    throw new BuildMetadataError(`no build metadata at ${path}`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new BuildMetadataError(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const validated = buildMetadataSchema.safeParse(parsed);

  if (!validated.success) {
    throw new BuildMetadataError(
      `${path} is not build metadata:\n${z.prettifyError(validated.error)}`,
    );
  }

  return validated.data;
}

export function runTemplateBuild({
  command,
  repositoryRoot,
  metadataPath,
  customerTemplateKey,
}: {
  command: string;
  repositoryRoot: string;
  metadataPath: string;
  customerTemplateKey: string | undefined;
}): number {
  if (!customerTemplateKey) {
    console.error(
      `${command} failed [MISSING_TEMPLATE_KEY]: CUSTOMER_TEMPLATE_KEY is not set`,
    );

    return EXIT_FAILURE;
  }

  try {
    const { template, fingerprint } = loadCustomerTemplate(
      repositoryRoot,
      customerTemplateKey,
    );

    writeBuildMetadata(metadataPath, {
      customerTemplateKey,
      schemaVersion: template.schemaVersion,
      fingerprint,
    });

    console.log(
      `${command} ${customerTemplateKey} schemaVersion ${template.schemaVersion} fingerprint ${fingerprint}`,
    );
  } catch (error) {
    if (error instanceof CustomerTemplateError) {
      console.error(`${command} failed [${error.code}]: ${error.message}`);
    } else {
      console.error(`${command} failed:`, error);
    }

    return EXIT_FAILURE;
  }

  return 0;
}
