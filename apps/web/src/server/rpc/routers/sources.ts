import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { installationProcedure } from "@rz-chain-reporter/api";
import { classifyDbError } from "@rz-chain-reporter/db/db-error";
import {
  SOURCE_IMPORT_COMMAND_TYPE,
  startSourceImport,
} from "@rz-chain-reporter/db/repositories/source-import";

import { selectImportableSourceIds } from "@/features/sources/db/queries";
import {
  startSourceImportInputSchema,
  startSourceImportResultSchema,
} from "@/features/sources/schemas/imports";
import { customerTemplateFingerprint } from "@/lib/customer-template.server";

import { rpcDb } from "../db";

export const startImport = installationProcedure
  .input(startSourceImportInputSchema)
  .output(startSourceImportResultSchema)
  .errors({
    UNAUTHORIZED: { status: 401 },
    VALIDATION_FAILED: { status: 400 },
    SOURCE_IMPORT_IN_PROGRESS: { status: 409 },
    TEMPLATE_DRIFT: { status: 409 },
    TRANSIENT_CONFLICT: { status: 409 },
    IDEMPOTENCY_KEY_REUSED: { status: 409 },
  })
  .handler(async ({ context, errors, input }) => {
    const database = rpcDb();
    const importable = await selectImportableSourceIds(
      database,
      context.workspaceId,
      input.sourceIds,
    );

    if (importable.length !== input.sourceIds.length) {
      throw errors.VALIDATION_FAILED();
    }

    const operationId = randomUUID();
    const idempotencyKey = `${SOURCE_IMPORT_COMMAND_TYPE}:${operationId}`;

    const result = await startSourceImport(database, context.workspaceId, {
      operationId,
      actor: context.session.user.id,
      idempotencyKey,
      requestHash: createHash("sha256")
        .update(`${idempotencyKey}:${SOURCE_IMPORT_COMMAND_TYPE}`)
        .digest("hex"),
      requestId: context.requestId,
      sourceIds: importable,
      windowHours: input.windowHours,
      orderingMode: input.orderingMode,
      topN: input.topN,
      topics: input.topics,
      enrichmentEnabled: input.enrichmentEnabled,
      templateFingerprint: customerTemplateFingerprint,
    }).catch((error: unknown) => {
      const failure = classifyDbError(error);

      if (
        failure?.kind === "code" &&
        failure.code === "SOURCE_IMPORT_IN_PROGRESS"
      ) {
        throw errors.SOURCE_IMPORT_IN_PROGRESS();
      }
      if (failure?.kind === "retry") {
        throw errors.TRANSIENT_CONFLICT();
      }
      throw error;
    });

    if (result.status === "empty_selection") {
      throw errors.VALIDATION_FAILED();
    }
    if (result.status === "mismatch") {
      throw errors.IDEMPOTENCY_KEY_REUSED();
    }
    if (result.status === "template_drift") {
      throw errors.TEMPLATE_DRIFT();
    }

    return { operationId: result.operationId };
  });
