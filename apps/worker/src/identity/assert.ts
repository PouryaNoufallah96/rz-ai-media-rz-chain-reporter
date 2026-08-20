import { readBuildMetadata } from "@rz-chain-reporter/customer-template/build-metadata";
import { loadCustomerTemplate } from "@rz-chain-reporter/customer-template/load";
import type { Executor } from "@rz-chain-reporter/db/executor";

const INSTALLATION_IDENTITY_ERROR_CODES = [
  "MISSING_TEMPLATE_KEY",
  "MISSING_DATABASE_URL",
  "KEY_MISMATCH",
  "FINGERPRINT_MISMATCH",
  "NOT_PROVISIONED",
  "MULTIPLE_INSTALLATIONS",
  "INSTALLATION_KEY_MISMATCH",
  "TEMPLATE_NOT_APPLIED",
] as const;

export type InstallationIdentityErrorCode =
  (typeof INSTALLATION_IDENTITY_ERROR_CODES)[number];

export class InstallationIdentityError extends Error {
  readonly code: InstallationIdentityErrorCode;

  constructor(code: InstallationIdentityErrorCode, message: string) {
    super(message);
    this.name = "InstallationIdentityError";
    this.code = code;
  }
}

export type InstallationIdentity = {
  customerTemplateKey: string;
  fingerprint: string;
};

// Truncate operational messages; fingerprints are configuration hashes, not secrets.
export function shortFingerprint(fingerprint: string) {
  return fingerprint.slice(0, 16);
}

export function assertBuildIdentity(
  artifactRoot: string,
  metadataPath: string,
  runtimeEnv: Record<string, string | undefined>,
): InstallationIdentity {
  const runtimeKey = runtimeEnv.CUSTOMER_TEMPLATE_KEY;

  if (!runtimeKey) {
    throw new InstallationIdentityError(
      "MISSING_TEMPLATE_KEY",
      "CUSTOMER_TEMPLATE_KEY is not set",
    );
  }

  const metadata = readBuildMetadata(metadataPath);

  if (metadata.customerTemplateKey !== runtimeKey) {
    throw new InstallationIdentityError(
      "KEY_MISMATCH",
      `this artifact was built for customer "${metadata.customerTemplateKey}" but CUSTOMER_TEMPLATE_KEY is "${runtimeKey}"`,
    );
  }

  // Load by the runtime key so a successful load proves build, runtime, and directory keys match.
  const loaded = loadCustomerTemplate(artifactRoot, runtimeKey);

  if (loaded.fingerprint !== metadata.fingerprint) {
    throw new InstallationIdentityError(
      "FINGERPRINT_MISMATCH",
      `template "${runtimeKey}" changed since this artifact was built (built ${shortFingerprint(metadata.fingerprint)}, on disk ${shortFingerprint(loaded.fingerprint)})`,
    );
  }

  return { customerTemplateKey: runtimeKey, fingerprint: loaded.fingerprint };
}

export async function assertAppliedIdentity(
  executor: Executor,
  identity: InstallationIdentity,
) {
  const [installation, extra] = await executor.query.workspace.findMany({
    columns: { customerTemplateFingerprint: true, customerTemplateKey: true },
    limit: 2,
  });

  if (!installation) {
    throw new InstallationIdentityError(
      "NOT_PROVISIONED",
      "no workspace row: run template:reconcile before starting",
    );
  }

  if (extra) {
    throw new InstallationIdentityError(
      "MULTIPLE_INSTALLATIONS",
      "more than one workspace row: one deployment serves exactly one customer",
    );
  }

  if (installation.customerTemplateKey !== identity.customerTemplateKey) {
    throw new InstallationIdentityError(
      "INSTALLATION_KEY_MISMATCH",
      `this database belongs to customer "${installation.customerTemplateKey ?? "none"}" but this artifact is "${identity.customerTemplateKey}"`,
    );
  }

  if (installation.customerTemplateFingerprint !== identity.fingerprint) {
    throw new InstallationIdentityError(
      "TEMPLATE_NOT_APPLIED",
      `template "${identity.customerTemplateKey}" is not the applied revision (loaded ${shortFingerprint(identity.fingerprint)}, applied ${shortFingerprint(installation.customerTemplateFingerprint ?? "none")}): run template:reconcile`,
    );
  }
}
