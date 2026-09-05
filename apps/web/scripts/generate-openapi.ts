import { mkdir, readFile, writeFile } from "node:fs/promises";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import { appRouter } from "@/server/rpc/routers/index";

// Fixed title: openapi.json must not vary per customer.
const API_TITLE = "ChainReporter API";

const target = new URL(
  "../../../documentation/reference/openapi.json",
  import.meta.url,
);

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

async function renderSnapshot() {
  const document = await generator.generate(appRouter, {
    info: { title: API_TITLE, version: "0.1.0" },
  });

  return `${JSON.stringify(document, null, 2)}\n`;
}

async function writeSnapshot() {
  const snapshot = await renderSnapshot();

  await mkdir(new URL(".", target), { recursive: true });
  await writeFile(target, snapshot);
}

async function checkSnapshot() {
  const [snapshot, committed] = await Promise.all([
    renderSnapshot(),
    readFile(target, "utf8").catch(() => null),
  ]);

  if (committed === snapshot) return;

  process.exitCode = 1;
  console.error(
    committed === null
      ? "openapi:check failed: documentation/reference/openapi.json is missing."
      : "openapi:check failed: documentation/reference/openapi.json no longer matches the router.",
  );
  console.error(
    "Run `pnpm --filter web openapi:generate` and review the diff.",
  );
}

if (process.argv.includes("--check")) {
  checkSnapshot();
} else {
  writeSnapshot();
}
