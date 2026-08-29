import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema";

export const DB_PROBE_TIMEOUT_MS = 2_000;

// query_timeout starts after checkout; pair it with connectionTimeoutMillis and this deadline.
async function probe(pool: Pool, timeoutMs: number) {
  // @types/pg omits query_timeout; excess-property checking only rejects fresh literals.
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
  const pool = new Pool({
    connectionTimeoutMillis: 10_000,
    max: 10,
    ...options,
    connectionString: databaseUrl,
  });
  return {
    db: drizzle(pool, { schema }),
    check: (timeoutMs = DB_PROBE_TIMEOUT_MS) => probe(pool, timeoutMs),
    close: () => pool.end(),
  };
}
