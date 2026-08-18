import { type ExtractTablesWithRelations, sql } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgTransaction } from "drizzle-orm/pg-core";

import type * as schema from "./schema";

type Schema = typeof schema;
type Tables = ExtractTablesWithRelations<Schema>;

export type Executor = PgDatabase<NodePgQueryResultHKT, Schema, Tables>;

export type Transaction = PgTransaction<NodePgQueryResultHKT, Schema, Tables>;

// The third argument is transaction-local; session-local would leak to the next pool borrower.
export async function withWorkspaceContext(
  tx: Transaction,
  workspaceId: string,
) {
  await tx.execute(
    sql`select set_config('app.workspace_id', ${workspaceId}, true)`,
  );
}
