import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema";

export const DB_PROBE_TIMEOUT_MS = 2_000;

// query_timeout only starts once a client is checked out, so acquisition needs
// the pool's own connectionTimeoutMillis or a host that accepts TCP and never
// answers hangs; the deadline then caps those two stacked bounds at one number.
async function probe(pool: Pool, timeoutMs: number) {
  // pg honors a per-query query_timeout at runtime; @types/pg omits it from
  // QueryConfig, and excess-property checking only rejects fresh literals.
  const query = { text: "select 1", query_timeout: timeoutMs };
  let timer: ReturnType<typeof setTimeout>;

  await Promise.race([
    pool.query(query),
    new Promise<never>((_, reject) => {
      timer = setTimeout(reject, timeoutMs, new Error("probe deadline"));
    }),
  ]).finally(() => clearTimeout(timer));
}

export function createDb(
  databaseUrl: string,
  options?: Omit<PoolConfig, "connectionString">,
) {
  const pool = new Pool({ ...options, connectionString: databaseUrl });
  return {
    db: drizzle(pool, { schema }),
    check: (timeoutMs = DB_PROBE_TIMEOUT_MS) => probe(pool, timeoutMs),
    close: () => pool.end(),
  };
}
