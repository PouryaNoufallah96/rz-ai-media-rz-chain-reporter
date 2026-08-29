import "server-only";

import { createDb, DB_PROBE_TIMEOUT_MS } from "@rz-chain-reporter/db";
import { env } from "@rz-chain-reporter/env/server";
import { connection } from "next/server";

import { customerTemplateFingerprint } from "@/lib/customer-template.server";

// HMR re-evaluates this module; a module-scope pool would leak per edit.
const pools = globalThis as typeof globalThis & {
  __readinessDb?: ReturnType<typeof createDb>;
};

function notReady(reason: string) {
  return Response.json(
    { status: "unavailable" as const, reason },
    { status: 503 },
  );
}

async function readAppliedState(database: ReturnType<typeof createDb>) {
  await database.check();

  let timer: ReturnType<typeof setTimeout>;

  return Promise.race([
    database.db.query.workspace.findMany({
      columns: { customerTemplateFingerprint: true },
      limit: 2,
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        reject,
        DB_PROBE_TIMEOUT_MS,
        new Error("readiness deadline"),
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function GET() {
  await connection();

  pools.__readinessDb ??= createDb(env.DATABASE_URL, {
    connectionTimeoutMillis: DB_PROBE_TIMEOUT_MS,
  });

  let rows: Awaited<ReturnType<typeof readAppliedState>>;

  try {
    rows = await readAppliedState(pools.__readinessDb);
  } catch {
    return notReady("database-unavailable");
  }

  const [installation, extra] = rows;

  if (!installation) {
    return notReady("not-provisioned");
  }
  if (extra) {
    return notReady("multiple-installations");
  }

  // Repeat the boot fingerprint check so a live process drops out after reconcile drift.
  // The reason names the mismatch, never the fingerprints.
  if (
    installation.customerTemplateFingerprint !== customerTemplateFingerprint
  ) {
    return notReady("template-not-applied");
  }

  return Response.json({ status: "ready" as const });
}
