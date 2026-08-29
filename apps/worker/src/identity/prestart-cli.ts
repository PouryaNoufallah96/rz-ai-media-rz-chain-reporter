import { fileURLToPath } from "node:url";
import {
  BUILD_METADATA_FILE,
  BuildMetadataError,
} from "@rz-chain-reporter/customer-template/build-metadata";
import {
  CustomerTemplateError,
  loadCustomerTemplate,
} from "@rz-chain-reporter/customer-template/load";
import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";
import { createDb, DB_PROBE_TIMEOUT_MS } from "@rz-chain-reporter/db";
import {
  DestinationBindingError,
  formatDestinationBindingReport,
} from "@rz-chain-reporter/env/destination-bindings";
import { validateWorkerEnv } from "@rz-chain-reporter/env/worker";
import {
  ModelBindingError,
  ModelTaskConfigurationError,
} from "@rz-chain-reporter/model-gateway/errors";
import { assertModelCapabilities } from "@rz-chain-reporter/model-gateway/prestart";
import { resolveModelTask } from "@rz-chain-reporter/model-gateway/task";
import { assertFirecrawlBinding } from "../articles/firecrawl";
import { checkDestinationBindings } from "../bindings/check";
import {
  assertObjectStoreBound,
  deriveWorkerRuntimeConfig,
  WorkerRuntimeBindingError,
  WorkerRuntimeConfigurationError,
} from "../runtime/config";
import {
  assertAppliedIdentity,
  assertBuildIdentity,
  InstallationIdentityError,
  shortFingerprint,
} from "./assert";

const EXIT_FAILURE = 1;
const EXIT_UNBOUND = 2;

const STAGES = ["web", "worker"] as const;

const ASSISTANT_TASK_KEY = "assistant-synthesis";

// Web serves the assistant through the remote provider only, so an unbound or
// locally routed task must stop the process instead of failing the first ask.
function assertAssistantBinding(template: CustomerTemplate) {
  const primary = resolveModelTask(template, ASSISTANT_TASK_KEY, "primary");
  const fallback = template.models.tasks[ASSISTANT_TASK_KEY]?.fallback;

  for (const backend of [primary.route.backend, fallback?.backend]) {
    if (backend !== undefined && backend !== "remote") {
      throw new ModelBindingError(
        `model task "${ASSISTANT_TASK_KEY}" selects a ${backend} backend, which web cannot serve`,
      );
    }
  }

  if (!process.env.OPENROUTER_API_KEY) {
    throw new ModelBindingError(
      `model task "${ASSISTANT_TASK_KEY}" selects an unbound remote backend`,
    );
  }
}

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

  if (stage === "web") {
    const objectStoreBindings = [
      process.env.S3_ACCESS_KEY_ID,
      process.env.S3_BUCKET,
      process.env.S3_ENDPOINT,
      process.env.S3_REGION,
      process.env.S3_SECRET_ACCESS_KEY,
    ];

    if (!objectStoreBindings.every(Boolean)) {
      throw new WorkerRuntimeBindingError(["object_store"]);
    }

    assertAssistantBinding(
      loadCustomerTemplate(artifactRoot, identity.customerTemplateKey).template,
    );
    console.log(`web model task ${ASSISTANT_TASK_KEY}: remote backend bound`);
  }

  if (stage === "worker") {
    const workerEnvironment = validateWorkerEnv(process.env);
    const runtime = deriveWorkerRuntimeConfig(workerEnvironment);
    console.log(`worker mode: ${runtime.mode}`);

    if (runtime.mode === "health-only") {
      console.log("worker capability bindings: disabled");
      process.exit(0);
    }

    assertObjectStoreBound(runtime);

    const loaded = loadCustomerTemplate(
      artifactRoot,
      identity.customerTemplateKey,
    );
    assertModelCapabilities(loaded.template, workerEnvironment);
    assertFirecrawlBinding(loaded.template, workerEnvironment);

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
  } else if (error instanceof WorkerRuntimeBindingError) {
    process.exitCode = EXIT_UNBOUND;
    console.error(`${command} failed [${error.code}]: ${error.message}`);
  } else if (error instanceof WorkerRuntimeConfigurationError) {
    console.error(`${command} failed [${error.code}]: ${error.message}`);
  } else if (error instanceof ModelBindingError) {
    process.exitCode = EXIT_UNBOUND;
    console.error(`${command} failed [${error.code}]: ${error.message}`);
  } else if (error instanceof ModelTaskConfigurationError) {
    console.error(`${command} failed [${error.code}]: ${error.message}`);
  } else {
    console.error(`${command} failed:`, error);
  }
}
