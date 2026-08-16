"use client";

import type { CommonORPCErrorCode, ORPCErrorJSON } from "@orpc/client";
import type { ActionableClient, ActionableClientRest } from "@orpc/server";
import { useState, useTransition } from "react";
import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";

export const UNKNOWN_ACTION_ERROR = "unknownError";

type ActionStatus = "idle" | "pending" | "success" | "error";

type UnknownActionError = typeof UNKNOWN_ACTION_ERROR;

type ActionCode<TError> =
  | (Extract<TError, { defined: true }> extends {
      code: infer TDeclared extends string;
    }
      ? TDeclared
      : never)
  | CommonORPCErrorCode
  | UnknownActionError;

export interface ActionState<TOutput, TCode extends string = string> {
  code?: TCode;
  data?: TOutput;
  fieldErrors?: Record<string, string>;
  requestId?: string;
  status: ActionStatus;
}

export interface UseActionOptions<TOutput, TCode extends string = string> {
  onError?: (state: ActionState<TOutput, TCode>) => void;
  onSettled?: (state: ActionState<TOutput, TCode>) => void;
  onSuccess?: (data: TOutput) => void;
}

const idleState = { status: "idle" } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Issue `message` is the stable code the presentation layer translates.
function extractFieldErrors(error: unknown) {
  if (!isRecord(error) || !isRecord(error.data)) return;
  const { issues } = error.data;
  if (!Array.isArray(issues)) return;

  // First issue per field, matching zodResolver.
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    if (!isRecord(issue) || typeof issue.message !== "string") continue;
    const path = Array.isArray(issue.path) ? issue.path : [];
    const name = path
      .map((segment) =>
        isRecord(segment) && "key" in segment
          ? String(segment.key)
          : String(segment),
      )
      .join(".");
    if (name && !(name in fields)) fields[name] = issue.message;
  }

  return Object.keys(fields).length > 0 ? fields : undefined;
}

function extractRequestId(error: unknown) {
  if (!isRecord(error) || !isRecord(error.data)) return;
  const { requestId } = error.data;
  return typeof requestId === "string" ? requestId : undefined;
}

function extractCode<TCode extends string>(
  error: unknown,
): TCode | UnknownActionError {
  if (isRecord(error) && typeof error.code === "string") {
    return error.code as TCode;
  }
  return UNKNOWN_ACTION_ERROR;
}

export function applyActionErrorToForm<TFieldValues extends FieldValues>(
  setError: UseFormSetError<TFieldValues>,
  state: ActionState<unknown>,
) {
  if (state.fieldErrors) {
    for (const [name, code] of Object.entries(state.fieldErrors)) {
      setError(name as FieldPath<TFieldValues>, {
        message: code,
        type: "server",
      });
    }
    return;
  }

  setError("root.server", {
    message: state.code ?? UNKNOWN_ACTION_ERROR,
    type: "server",
  });
}

export function useAction<
  TInput,
  TOutput,
  TError extends ORPCErrorJSON<string, unknown>,
>(
  action: ActionableClient<TInput, TOutput, TError>,
  options: UseActionOptions<TOutput, ActionCode<TError>> = {},
) {
  type Code = ActionCode<TError>;
  type State = ActionState<TOutput, Code>;

  const [state, setState] = useState<State>(idleState);
  const [isPending, startTransition] = useTransition();

  const reset = () => setState(idleState);

  const execute = (...input: ActionableClientRest<TInput>) =>
    new Promise<State>((resolve) => {
      startTransition(async () => {
        const next = await settle(...input);
        setState(next);

        if (next.status === "success" && next.data !== undefined) {
          options.onSuccess?.(next.data);
        } else {
          options.onError?.(next);
        }
        options.onSettled?.(next);
        resolve(next);
      });
    });

  async function settle(
    ...input: ActionableClientRest<TInput>
  ): Promise<State> {
    try {
      const [error, data] = await action(...input);

      if (error) {
        return {
          code: extractCode<Code>(error),
          fieldErrors: extractFieldErrors(error),
          requestId: extractRequestId(error),
          status: "error",
        };
      }

      if (data === undefined) {
        return { code: UNKNOWN_ACTION_ERROR, status: "error" };
      }

      return { data, status: "success" };
    } catch {
      return { code: UNKNOWN_ACTION_ERROR, status: "error" };
    }
  }

  return { ...state, execute, isPending, reset };
}
