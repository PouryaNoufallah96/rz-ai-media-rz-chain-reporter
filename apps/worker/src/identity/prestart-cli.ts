import { fileURLToPath } from "node:url";
import { CustomerTemplateError } from "@rz-chain-reporter/customer-template/load";
import { createDb, DB_PROBE_TIMEOUT_MS } from "@rz-chain-reporter/db";
import {
  DestinationBindingError,
  formatDestinationBindingReport,
} from "@rz-chain-reporter/env/destination-bindings";

import { checkDestinationBindings } from "../bindings/check";
import {
  assertAppliedIdentity,
  assertBuildIdentity,
  InstallationIdentityError,
  shortFingerprint,
} from "./assert";
import { BUILD_METADATA_FILE, BuildMetadataError } from "./build-metadata";

const EXIT_FAILURE = 1;
const EXIT_UNBOUND = 2;

const STAGES = ["web", "worker"] as const;

type Stage = (typeof STAGES)[number];

function parseStage(argument: string | undefined): Stage | null {
  return STAGES.find((stage) => stage === argument) ?? null;
}

const stage = parseStage(process.argv[2]);

if (stage === null || process.argv.length > 3) {
  console.error(
    `prestart failed [USAGE]: expected exactly one stage argument, ${STAGES.join(" or ")}`,
  );
  process.exit(EXIT_FAILURE);
}

const command = `prestart:${stage}`;
// cwd() is artifact root in images and a checkout; one prestart bundle for web and worker.
const artifactRoot = process.cwd();
const metadataPath = fileURLToPath(
  new URL(BUILD_METADATA_FILE, import.meta.url),
);

try {
  const identity = assertBuildIdentity(artifactRoot, metadataPath, process.env);
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new InstallationIdentityError(
      "MISSING_DATABASE_URL",
      "DATABASE_URL is not set",
    );
  }

  const database = createDb(databaseUrl, {
    connectionTimeoutMillis: DB_PROBE_TIMEOUT_MS,
  });

  try {
    await assertAppliedIdentity(database.db, identity);
  } finally {
    await database.close();
  }

  console.log(
    `${command} ${identity.customerTemplateKey} ${shortFingerprint(identity.fingerprint)}`,
  );
  console.log("build, runtime, loaded and applied template identity match");

  if (stage === "worker") {
    const report = checkDestinationBindings(
      artifactRoot,
      identity.customerTemplateKey,
      process.env,
    );

    console.log(formatDestinationBindingReport(report));

    if (!report.satisfied) {
      process.exitCode = EXIT_UNBOUND;
    }
  }
} catch (error) {
  process.exitCode = EXIT_FAILURE;

  if (
    error instanceof BuildMetadataError ||
    error instanceof CustomerTemplateError ||
    error instanceof DestinationBindingError ||
    error instanceof InstallationIdentityError
  ) {
    console.error(`${command} failed [${error.code}]: ${error.message}`);
  } else {
    console.error(`${command} failed:`, error);
  }
}
