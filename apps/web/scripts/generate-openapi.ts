import { mkdir, writeFile } from "node:fs/promises";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import { PRODUCT_NAME } from "@/lib/branding";
import { appRouter } from "@/server/rpc/routers/index";

const target = new URL("../../../docs/api/openapi.json", import.meta.url);

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

async function writeSnapshot() {
  const document = await generator.generate(appRouter, {
    info: { title: `${PRODUCT_NAME} API`, version: "0.1.0" },
  });

  await mkdir(new URL(".", target), { recursive: true });
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
}

// apps/web is not `"type": "module"`, so tsx compiles this file to CJS, where
// top-level await is unavailable. A rejection still exits non-zero.
writeSnapshot();
