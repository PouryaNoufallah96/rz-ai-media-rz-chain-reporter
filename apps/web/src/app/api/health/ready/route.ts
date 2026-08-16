import "server-only";

import { createDb, DB_PROBE_TIMEOUT_MS } from "@rz-chain-reporter/db";
import { env } from "@rz-chain-reporter/env/server";
import { connection } from "next/server";

// HMR re-evaluates this module; a module-scope pool would leak per edit.
const pools = globalThis as typeof globalThis & {
  __readinessDb?: ReturnType<typeof createDb>;
};

export async function GET() {
  await connection();

  pools.__readinessDb ??= createDb(env.DATABASE_URL, {
    connectionTimeoutMillis: DB_PROBE_TIMEOUT_MS,
  });

  try {
    await pools.__readinessDb.check();
  } catch {
    return Response.json({ status: "unavailable" as const }, { status: 503 });
  }

  return Response.json({ status: "ready" as const });
}
