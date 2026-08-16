import { fileURLToPath } from "node:url";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDb } from "./index";

dotenv.config({
  path: "../../.env.migration",
});

const migrationEnv = validateMigrationEnv(process.env);

const database = createDb(migrationEnv.MIGRATION_DATABASE_URL);

try {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)),
  });
} finally {
  await database.close();
}
