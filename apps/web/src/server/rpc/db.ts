import "server-only";

import { createDb } from "@rz-chain-reporter/db";
import { env } from "@rz-chain-reporter/env/server";

// HMR re-evaluates this module; a module-scope pool would leak per edit.
const pools = globalThis as typeof globalThis & {
  __rpcDb?: ReturnType<typeof createDb>;
};

export function rpcDb() {
  pools.__rpcDb ??= createDb(env.DATABASE_URL, { pipeline: true });
  return pools.__rpcDb.db;
}
