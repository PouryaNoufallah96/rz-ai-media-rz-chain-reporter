import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { installationProcedure } from "@rz-chain-reporter/api";
import { okSchema, runConfigurationSchema } from "@rz-chain-reporter/contracts";
import { classifyDbError } from "@rz-chain-reporter/db/db-error";
import {
  ANALYSIS_RUN_COMMAND_TYPE,
  requestAnalysisRunCancellation,
  startAnalysisRun,
} from "@rz-chain-reporter/db/repositories/analysis-run";

import { readRunLifecycle } from "@/features/editorial/db/queries";
import {
  cancelAnalysisRunInputSchema,
  startAnalysisRunInputSchema,
  startAnalysisRunResultSchema,
} from "@/features/editorial/schemas/workspace";
import {
  customerEditorial,
  customerTemplateFingerprint,
} from "@/lib/customer-template.server";

import { rpcDb } from "../db";

const TERMINAL_LIFECYCLES = ["succeeded", "failed", "cancelled", "unknown"];

const customerRunConfigurationSchema = runConfigurationSchema(
  customerEditorial.bounds,
);

export const startRun = installationProcedure
  .input(startAnalysisRunInputSchema)
  .output(startAnalysisRunResultSchema)
  .errors({
    UNAUTHORIZED: { status: 401 },
    VALIDATION_FAILED: { status: 400 },
    TRANSIENT_CONFLICT: { status: 409 },
    IDEMPOTENCY_KEY_REUSED: { status: 409 },
  })
  .handler(async ({ context, errors, input }) => {
    const parsed = customerRunConfigurationSchema.safeParse(input);

    if (!parsed.success) {
      throw errors.VALIDATION_FAILED({ data: { issues: parsed.error.issues } });
    }

    const configuration = parsed.data;
    const operationId = randomUUID();
    const idempotencyKey = `${ANALYSIS_RUN_COMMAND_TYPE}:${operationId}`;

    const result = await startAnalysisRun(rpcDb(), context.workspaceId, {
      operationId,
      actor: context.session.user.id,
      idempotencyKey,
      requestHash: createHash("sha256")
        .update(`${idempotencyKey}:${ANALYSIS_RUN_COMMAND_TYPE}`)
        .digest("hex"),
      requestId: context.requestId,
      kind: configuration.kind,
      configuration,
      templateFingerprint: customerTemplateFingerprint,
    }).catch((error: unknown) => {
      if (classifyDbError(error)?.kind === "retry") {
        throw errors.TRANSIENT_CONFLICT();
      }
      throw error;
    });

    if (result.status === "mismatch") {
      throw errors.IDEMPOTENCY_KEY_REUSED();
    }

    return { operationId: result.operationId };
  });

export const cancelRun = installationProcedure
  .input(cancelAnalysisRunInputSchema)
  .output(okSchema)
  .errors({
    UNAUTHORIZED: { status: 401 },
    NOT_FOUND: { status: 404 },
  })
  .handler(async ({ context, errors, input }) => {
    const database = rpcDb();
    const run = await readRunLifecycle(
      database,
      context.workspaceId,
      input.analysisRunId,
    );

    if (!run) {
      throw errors.NOT_FOUND();
    }

    // A settled run keeps its real outcome: no timestamp, no outbox event.
    if (TERMINAL_LIFECYCLES.includes(run.lifecycle)) {
      return { ok: true };
    }

    const result = await requestAnalysisRunCancellation(
      database,
      context.workspaceId,
      input.analysisRunId,
    );

    if (result.status === "not_found") {
      throw errors.NOT_FOUND();
    }

    return { ok: true };
  });
