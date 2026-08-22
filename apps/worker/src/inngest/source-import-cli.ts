import { createHash, randomUUID } from "node:crypto";
import {
  telegramOrderingModeSchema,
  workspaceCacheTag,
} from "@rz-chain-reporter/contracts";
import { classifyDbError } from "@rz-chain-reporter/db/db-error";
import { startSourceImport } from "@rz-chain-reporter/db/repositories/source-import";
import { user } from "@rz-chain-reporter/db/schema/auth";
import { source } from "@rz-chain-reporter/db/schema/source";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { notifyCacheInvalidation } from "../web-cache/notify";
import { assertWorkspace, openWorkerRuntime } from "./runtime";
import { settleSourceImportOperation } from "./source-import";

const EXIT_FAILURE = 1;
const operationIdSchema = z.uuid();
const startOptionsSchema = z.object({
  enrichment: z.enum(["on", "off"]).optional(),
  kinds: z.string().optional(),
  ordering: telegramOrderingModeSchema.optional(),
  sources: z.string().optional(),
  topics: z.string().optional(),
  "top-n": z.coerce.number().int().min(1).max(20).optional(),
  window: z.coerce.number().int().min(1).max(168).optional(),
});

const { database, identity, template } = openWorkerRuntime();

try {
  const installation = await assertWorkspace({ db: database.db, identity });
  const [command, ...args] = process.argv.slice(2);

  if (command === "start") {
    await startImport(installation.workspaceId, args);
  } else if (command === "settle") {
    await settleImport(installation.workspaceId, args);
  } else {
    failUsage();
  }
} catch (error) {
  if (process.exitCode === undefined) {
    process.exitCode = EXIT_FAILURE;
    console.error(`source-import failed [${failureOf(error)}]`);
  }
} finally {
  await database.close();
}

function failureOf(error: unknown) {
  const mapped = classifyDbError(error);
  if (mapped?.kind === "code") {
    return mapped.code;
  }
  return error instanceof Error && mapped === undefined
    ? error.message
    : "UNKNOWN";
}

function parseOptions(args: string[]) {
  const entries = args.map((arg) => {
    const [flag, ...rest] = arg.replace(/^--/, "").split("=");
    return [flag ?? "", rest.join("=")] as const;
  });
  const parsed = startOptionsSchema.safeParse(Object.fromEntries(entries));
  if (!parsed.success) {
    failUsage();
  }
  return parsed.data;
}

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

async function startImport(workspaceId: string, args: string[]) {
  const options = parseOptions(args);
  const keys = list(options.sources);
  const kinds = list(options.kinds);

  const catalog = await database.db
    .select({ id: source.id, key: source.key, origin: source.origin })
    .from(source)
    .where(
      and(
        eq(source.workspaceId, workspaceId),
        eq(source.enabled, true),
        isNull(source.deletedAt),
      ),
    )
    .orderBy(asc(source.key));

  const selected = catalog.filter(
    (entry) =>
      (keys.length === 0 || keys.includes(entry.key)) &&
      (kinds.length === 0 || kinds.includes(entry.origin)),
  );
  if (selected.length === 0) {
    throw new Error("EMPTY_SELECTION");
  }

  const [actor] = await database.db
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt))
    .limit(1);
  if (!actor) {
    throw new Error("OPERATOR_REQUIRED");
  }

  const operationId = randomUUID();
  const idempotencyKey = `source-import:${operationId}`;
  const result = await startSourceImport(database.db, workspaceId, {
    operationId,
    actor: actor.id,
    idempotencyKey,
    requestHash: createHash("sha256").update(idempotencyKey).digest("hex"),
    requestId: null,
    sourceIds: selected.map((entry) => entry.id),
    windowHours: options.window ?? template.acquisition.defaultWindowHours,
    orderingMode:
      options.ordering ?? template.acquisition.telegram.orderingMode,
    topN: options["top-n"] ?? template.acquisition.telegram.topN,
    topics: list(options.topics),
    enrichmentEnabled:
      options.enrichment === undefined
        ? template.enrichment.enabled
        : options.enrichment === "on",
    templateFingerprint: identity.fingerprint,
  });

  if (result.status !== "created") {
    throw new Error(result.status.toUpperCase());
  }
  console.log(
    `source-import started operation=${operationId} sources=${selected.length}`,
  );
}

async function settleImport(workspaceId: string, args: string[]) {
  const parsedId = operationIdSchema.safeParse(args[0]);
  if (!parsedId.success || args.length !== 1) {
    failUsage();
  }

  const settled = await settleSourceImportOperation(
    database.db,
    workspaceId,
    parsedId.data,
    null,
  );
  if (!settled) {
    throw new Error("ALREADY_TERMINAL");
  }

  const cacheInvalidation = await notifyCacheInvalidation([
    workspaceCacheTag(workspaceId, "sources"),
  ]);
  console.log(
    `source-import settled operation=${parsedId.data} lifecycle=${settled.lifecycle} cache=${cacheInvalidation}`,
  );
}

function failUsage(): never {
  throw new Error(
    "USAGE: start [--sources=k1,k2] [--kinds=rss,telegram_public] [--window=24] [--ordering=views] [--top-n=10] [--topics=a,b] [--enrichment=on|off] | settle <operation-id>",
  );
}
