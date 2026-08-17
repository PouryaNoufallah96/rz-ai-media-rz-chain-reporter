import { type ExtractTablesWithRelations, sql } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgTransaction } from "drizzle-orm/pg-core";

import type * as schema from "./schema";

type Schema = typeof schema;
type Tables = ExtractTablesWithRelations<Schema>;

export type Executor = PgDatabase<NodePgQueryResultHKT, Schema, Tables>;

export type Transaction = PgTransaction<NodePgQueryResultHKT, Schema, Tables>;

// The third `set_config` argument is what makes the setting transaction-local:
// a session-local one outlives the checkout and leaks workspace context to the
// next borrower of the pooled connection.
export async function withWorkspaceContext(
  tx: Transaction,
  workspaceId: string,
) {
  await tx.execute(
    sql`select set_config('app.workspace_id', ${workspaceId}, true)`,
  );
}
