import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadCustomerTemplate } from "./load";

function findRepositoryRoot(start: string) {
  let candidate = resolve(start);

  while (!existsSync(resolve(candidate, "customer-templates"))) {
    const parent = dirname(candidate);

    if (parent === candidate) {
      throw new Error(`Could not find customer-templates above ${start}`);
    }

    candidate = parent;
  }

  return candidate;
}

const rootDir = findRepositoryRoot(process.cwd());
const keys = process.argv.slice(2);
const selectedKeys =
  keys.length > 0
    ? keys
    : readdirSync(resolve(rootDir, "customer-templates"), {
        withFileTypes: true,
      })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            existsSync(
              resolve(
                rootDir,
                "customer-templates",
                entry.name,
                "template.json",
              ),
            ),
        )
        .map((entry) => entry.name)
        .sort();

if (selectedKeys.length === 0) {
  throw new Error("No customer templates found");
}

for (const key of selectedKeys) {
  const loaded = loadCustomerTemplate(rootDir, key);

  process.stdout.write(
    `${JSON.stringify({
      customerTemplate: key,
      schemaVersion: loaded.template.schemaVersion,
      fingerprint: loaded.fingerprint,
      verifiedChecksums: loaded.references.length,
    })}\n`,
  );
}
