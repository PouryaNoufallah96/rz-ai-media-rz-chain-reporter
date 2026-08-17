import type { ErrorCode } from "@rz-chain-reporter/contracts";
import { DatabaseError } from "pg";

export const OPERATION_IDENTITY_CONSTRAINT =
  "uq_operation_workspace_id_actor_command_type_idempotency_key";

export const SAVED_CARD_ACTIVE_CONSTRAINT =
  "uq_saved_card_workspace_id_saved_by_platform_draft_id_active";

type MappedErrorCode = Extract<
  ErrorCode,
  "NOT_FOUND" | "SAVED_CARD_ALREADY_ACTIVE"
>;

export type DbFailure =
  | { kind: "code"; code: MappedErrorCode }
  // The walker cannot see the stored request_hash, so the use case decides
  // between replay and idempotency mismatch.
  | { kind: "operation_identity" }
  | { kind: "retry" };

const UNIQUE_VIOLATIONS = new Map<string, DbFailure>([
  [OPERATION_IDENTITY_CONSTRAINT, { kind: "operation_identity" }],
  [
    SAVED_CARD_ACTIVE_CONSTRAINT,
    { kind: "code", code: "SAVED_CARD_ALREADY_ACTIVE" },
  ],
]);

function findDatabaseError(error: unknown) {
  let current: unknown = error;

  while (typeof current === "object" && current !== null) {
    if (current instanceof DatabaseError) {
      return current;
    }
    current = "cause" in current ? current.cause : undefined;
  }

  return undefined;
}

export function classifyDbError(error: unknown): DbFailure | undefined {
  const databaseError = findDatabaseError(error);
  if (!databaseError?.code) {
    return undefined;
  }

  if (databaseError.code === "40001" || databaseError.code === "40P01") {
    return { kind: "retry" };
  }

  const { constraint } = databaseError;
  if (!constraint) {
    return undefined;
  }

  if (databaseError.code === "23505") {
    return UNIQUE_VIOLATIONS.get(constraint);
  }

  if (databaseError.code === "23503" && constraint.startsWith("fk_")) {
    return { kind: "code", code: "NOT_FOUND" };
  }

  return undefined;
}
