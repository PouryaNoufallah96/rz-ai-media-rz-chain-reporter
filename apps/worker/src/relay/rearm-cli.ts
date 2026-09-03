import { z } from "zod";

const EXIT_FAILURE = 1;
const operationId = z.uuid().safeParse(process.argv[2]);

if (!operationId.success || process.argv.length !== 3) {
  console.error("relay:rearm failed [USAGE]: expected operation id");
  process.exit(EXIT_FAILURE);
}
const targetOperationId = operationId.data;

async function main() {
  const {
    OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME,
    OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME,
    OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME,
    OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
    OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME,
    OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME,
    OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME,
    OPERATION_PUBLICATION_RECONCILIATION_REQUESTED_EVENT_NAME,
    OPERATION_PUBLICATION_REQUESTED_EVENT_NAME,
    OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME,
    workspaceCacheTag,
  } = await import("@rz-chain-reporter/contracts");
  const { findCopyExecutionContext } = await import(
    "@rz-chain-reporter/db/repositories/copy-generation"
  );
  const { findImageExecutionContext } = await import(
    "@rz-chain-reporter/db/repositories/image-generation"
  );
  const { rearmOutboxEvent } = await import(
    "@rz-chain-reporter/db/repositories/outbox-relay"
  );
  const { assertWorkspace, openWorkerRuntime } = await import(
    "../inngest/runtime"
  );
  const { notifyDraftsCacheChanged } = await import("../web-cache/drafts");
  const { notifyPublishingCacheChanged } = await import(
    "../web-cache/publishing"
  );
  const { notifyCacheInvalidation } = await import("../web-cache/notify");
  const { database, identity } = openWorkerRuntime();

  try {
    const installation = await assertWorkspace({ db: database.db, identity });
    const events = await database.db.query.outboxEvent.findMany({
      where: (event, { and, eq, isNotNull, isNull }) =>
        and(
          eq(event.workspaceId, installation.workspaceId),
          eq(event.operationId, targetOperationId),
          isNull(event.dispatchedAt),
          isNotNull(event.exhaustedAt),
        ),
      limit: 2,
    });
    const [event] = events;
    if (!event || events.length !== 1) {
      throw new Error("expected exactly one exhausted event");
    }
    const rearmed = await rearmOutboxEvent(
      database.db,
      installation.workspaceId,
      { id: event.id },
    );
    if (!rearmed) throw new Error("exhausted event changed before rearm");

    const notifyCopy = async (copyOperationId: string) => {
      const context = await findCopyExecutionContext(
        database.db,
        installation.workspaceId,
        copyOperationId,
      );
      if (!context) throw new Error("copy context not found");
      return context.executionScope.kind === "market_analysis"
        ? notifyCacheInvalidation([
            workspaceCacheTag(installation.workspaceId, "market-analysis"),
            workspaceCacheTag(installation.workspaceId, "drafts"),
          ])
        : notifyDraftsCacheChanged(installation.workspaceId);
    };
    const cacheInvalidation = await (async () => {
      try {
        if (event.eventType === OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME) {
          return await notifyCacheInvalidation([
            workspaceCacheTag(installation.workspaceId, "sources"),
          ]);
        }
        if (
          event.eventType === OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME
        ) {
          return await notifyCopy(targetOperationId);
        }
        if (
          event.eventType === OPERATION_PUBLICATION_REQUESTED_EVENT_NAME ||
          event.eventType ===
            OPERATION_PUBLICATION_RECONCILIATION_REQUESTED_EVENT_NAME
        ) {
          return await notifyPublishingCacheChanged(installation.workspaceId);
        }
        if (
          event.eventType === OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME ||
          event.eventType === OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME
        ) {
          return await notifyCacheInvalidation([
            workspaceCacheTag(installation.workspaceId, "editorial"),
          ]);
        }
        if (
          event.eventType ===
            OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME ||
          event.eventType ===
            OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME ||
          event.eventType === OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME
        ) {
          return await notifyCacheInvalidation([
            workspaceCacheTag(installation.workspaceId, "market-analysis"),
          ]);
        }
        if (
          event.eventType !== OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME
        ) {
          return "not-applicable";
        }
        const context = await findImageExecutionContext(
          database.db,
          installation.workspaceId,
          targetOperationId,
        );
        if (!context) throw new Error("image context not found");
        return await notifyCopy(context.copyOperationId);
      } catch {
        return "failed";
      }
    })();
    console.log(
      `relay:rearm ${targetOperationId} rearmed cache=${cacheInvalidation}`,
    );
  } finally {
    await database.close();
  }
}

void main().catch(() => {
  process.exitCode = EXIT_FAILURE;
  console.error("relay:rearm failed [REARM_REJECTED]");
});
