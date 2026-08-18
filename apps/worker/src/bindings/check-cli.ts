import { fileURLToPath } from "node:url";
import { CustomerTemplateError } from "@rz-chain-reporter/customer-template/load";
import {
  DestinationBindingError,
  formatDestinationBindingReport,
} from "@rz-chain-reporter/env/destination-bindings";

import { checkDestinationBindings } from "./check";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const EXIT_FAILURE = 1;
const EXIT_UNBOUND = 2;

const STAGES = ["preflight", "prestart"] as const;

type Stage = (typeof STAGES)[number];

function parseStage(argument: string | undefined): Stage | null {
  return STAGES.find((stage) => stage === argument) ?? null;
}

const stage = parseStage(process.argv[2]);

if (stage === null || process.argv.length > 3) {
  console.error(
    `bindings failed [USAGE]: expected exactly one stage argument, ${STAGES.join(" or ")}`,
  );
  process.exit(EXIT_FAILURE);
}

const command = `bindings:${stage}`;
const customerTemplateKey = process.env.CUSTOMER_TEMPLATE_KEY;

if (!customerTemplateKey) {
  console.error(
    `${command} failed [MISSING_TEMPLATE_KEY]: CUSTOMER_TEMPLATE_KEY is not set`,
  );
  process.exit(EXIT_FAILURE);
}

try {
  const report = checkDestinationBindings(
    repositoryRoot,
    customerTemplateKey,
    process.env,
  );

  console.log(`${command} ${customerTemplateKey}`);
  console.log(formatDestinationBindingReport(report));

  if (!report.satisfied) {
    process.exitCode = EXIT_UNBOUND;
  }
} catch (error) {
  process.exitCode = EXIT_FAILURE;

  if (
    error instanceof CustomerTemplateError ||
    error instanceof DestinationBindingError
  ) {
    console.error(`${command} failed [${error.code}]: ${error.message}`);
  } else {
    console.error(`${command} failed:`, error);
  }
}
