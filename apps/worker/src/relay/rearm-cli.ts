import { rearmOutboxEvent } from "@rz-chain-reporter/db/repositories/outbox-relay";
import { z } from "zod";

import { assertWorkspace, openWorkerRuntime } from "../inngest/runtime";

const EXIT_FAILURE = 1;
const operationIdSchema = z.uuid();
const operationId = operationIdSchema.safeParse(process.argv[2]);

if (!operationId.success || process.argv.length > 3) {
  console.error("relay:rearm failed [USAGE]: expected one operation id");
  process.exit(EXIT_FAILURE);
}

const { database, identity } = openWorkerRuntime();

try {
  const installation = await assertWorkspace({ db: database.db, identity });
  const events = await database.db.query.outboxEvent.findMany({
    where: (event, { and, eq, isNotNull, isNull }) =>
      and(
        eq(event.workspaceId, installation.workspaceId),
        eq(event.operationId, operationId.data),
        isNull(event.dispatchedAt),
        isNotNull(event.exhaustedAt),
      ),
    limit: 2,
  });

  const [event] = events;
  if (!event || events.length !== 1) {
    throw new Error("expected exactly one exhausted event for the operation");
  }

  const rearmed = await rearmOutboxEvent(
    database.db,
    installation.workspaceId,
    { id: event.id },
  );
  if (!rearmed) {
    throw new Error("exhausted event changed before rearm");
  }

  console.log(`relay:rearm ${operationId.data} rearmed`);
} catch {
  process.exitCode = EXIT_FAILURE;
  console.error("relay:rearm failed [REARM_REJECTED]");
} finally {
  await database.close();
}
