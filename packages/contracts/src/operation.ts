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

const UNSAFE_OPERATOR_DIRECTION_CODE_POINTS = new Set([
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
  0x2067, 0x2068, 0x2069,
]);

function hasUnsafeOperatorDirectionCodePoint(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x08 ||
      (codePoint >= 0x0b && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      UNSAFE_OPERATOR_DIRECTION_CODE_POINTS.has(codePoint)
    );
  });
}

export function normalizeOperatorImageDirection(value: string) {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim()
    .normalize("NFC");
}

export const operatorImageDirectionSchema = z
  .string()
  .transform(normalizeOperatorImageDirection)
  .superRefine((value, context) => {
    const codePoints = Array.from(value);
    const utf8Bytes = codePoints.reduce((total, character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        total +
        (codePoint <= 0x7f
          ? 1
          : codePoint <= 0x7ff
            ? 2
            : codePoint <= 0xffff
              ? 3
              : 4)
      );
    }, 0);
    if (
      codePoints.length > 1_000 ||
      utf8Bytes > 4_000 ||
      hasUnsafeOperatorDirectionCodePoint(value)
    ) {
      context.addIssue({
        code: "custom",
        message: "OPERATOR_DIRECTION_INVALID",
      });
    }
  })
  .transform((value) => value || undefined);

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
