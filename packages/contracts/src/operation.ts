import { z } from "zod";

import {
  ANALYSIS_RUN_COMMAND_PREFIX,
  GENERATION_PROBE_COMMAND_PREFIX,
  MEDIA_UPLOAD_CONFIRMED_EVENT_NAME,
  SCHEDULED_EFFECT_PROBE_COMMAND_PREFIX,
  SOURCE_IMPORT_COMMAND_PREFIX,
} from "./events";

export const OPERATION_LIFECYCLES = [
  "queued",
  "running",
  "settling",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
] as const;

export type OperationLifecycle = (typeof OPERATION_LIFECYCLES)[number];

export const operationLifecycleSchema = z.enum(OPERATION_LIFECYCLES);

export const ATTEMPT_OUTCOMES = [
  "succeeded",
  "failed_retryable",
  "failed_terminal",
  "ambiguous",
] as const;

export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export const attemptOutcomeSchema = z.enum(ATTEMPT_OUTCOMES);

export const DISPATCH_STATES = [
  "undispatched",
  "delayed",
  "dispatched",
  "exhausted",
] as const;

export type DispatchState = (typeof DISPATCH_STATES)[number];

export const dispatchStateSchema = z.enum(DISPATCH_STATES);

export const INVOCATION_KEYS = ["primary", "retry-1", "fallback"] as const;

export type InvocationKey = (typeof INVOCATION_KEYS)[number];

export const invocationKeySchema = z.enum(INVOCATION_KEYS);

export const MODEL_BACKENDS = ["remote", "local"] as const;

export type ModelBackend = (typeof MODEL_BACKENDS)[number];

export const modelBackendSchema = z.enum(MODEL_BACKENDS);

export const OPERATION_COMMAND_KINDS = [
  "generation-probe",
  "scheduled-effect-probe",
  "media-verification",
  "source-import",
  "analysis-run",
  "other",
] as const;

export type OperationCommandKind = (typeof OPERATION_COMMAND_KINDS)[number];

export function operationCommandKind(
  commandType: string,
): OperationCommandKind {
  if (commandType.startsWith(GENERATION_PROBE_COMMAND_PREFIX)) {
    return "generation-probe";
  }
  if (commandType.startsWith(SCHEDULED_EFFECT_PROBE_COMMAND_PREFIX)) {
    return "scheduled-effect-probe";
  }
  if (commandType.startsWith(SOURCE_IMPORT_COMMAND_PREFIX)) {
    return "source-import";
  }
  if (commandType.startsWith(ANALYSIS_RUN_COMMAND_PREFIX)) {
    return "analysis-run";
  }
  if (commandType === MEDIA_UPLOAD_CONFIRMED_EVENT_NAME) {
    return "media-verification";
  }
  return "other";
}

export function operationCommandVariant(commandType: string, prefix: string) {
  return commandType.startsWith(prefix)
    ? commandType.slice(prefix.length)
    : null;
}
