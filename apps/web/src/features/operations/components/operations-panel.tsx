import type { ErrorCode } from "@rz-chain-reporter/contracts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
} from "@rz-chain-reporter/ui/components/empty";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { useFormatter, useTranslations } from "next-intl";

import { useFallbackErrorMessage } from "@/components/form/use-error-message";
import { OPERATIONS_NAMESPACE } from "../constants";
import type { OperationSummary } from "../schemas/operation-summary";
import { panelStateOf } from "./panel-state";
import { StateMark } from "./state-mark";

const MESSAGE_KEYS = {
  FORBIDDEN: "errors.forbidden",
  IDEMPOTENCY_KEY_REUSED: "errors.idempotencyKeyReused",
  INTERNAL_SERVER_ERROR: "errors.internalServerError",
  NOT_FOUND: "errors.notFound",
  SAVED_CARD_ALREADY_ACTIVE: "errors.savedCardAlreadyActive",
  TRANSIENT_CONFLICT: "errors.transientConflict",
  UNAUTHORIZED: "errors.unauthorized",
  VALIDATION_FAILED: "errors.validationFailed",
  VERSION_CONFLICT: "errors.versionConflict",
} as const;

type MappedCode = keyof typeof MESSAGE_KEYS;

function isMappedCode(code: ErrorCode): code is MappedCode {
  return code in MESSAGE_KEYS;
}

export function OperationsPanel({
  isError,
  isFetching,
  operations,
}: {
  isError: boolean;
  isFetching: boolean;
  operations: OperationSummary[];
}) {
  const t = useTranslations(OPERATIONS_NAMESPACE);

  if (operations.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyDescription>
            {isError ? t("errors.internalServerError") : t("panel.empty")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul
      aria-busy={isFetching}
      className="flex flex-col transition-opacity aria-busy:opacity-70 motion-reduce:transition-none"
      data-pending={isFetching || undefined}
    >
      {operations.map((operation) => (
        <OperationRow key={operation.id} operation={operation} />
      ))}
    </ul>
  );
}

function OperationRow({ operation }: { operation: OperationSummary }) {
  const format = useFormatter();
  const t = useTranslations(OPERATIONS_NAMESPACE);
  const state = panelStateOf(operation);

  return (
    <li className="flex items-start gap-3 border-border border-b py-2 last:border-b-0">
      <StateMark state={state} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="ticket-label truncate text-muted-foreground">
          {operation.platform
            ? `${operation.commandType} · ${operation.platform}`
            : operation.commandType}
        </span>
        <span className="text-sm">
          {state === "retrying"
            ? t("state.retrying", { n: operation.attemptCount })
            : t(`state.${state}`)}
        </span>
        {state === "failed" ? (
          <FailureMessage code={operation.failureCode} />
        ) : null}
      </div>
      <time
        className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums"
        dateTime={operation.createdAt.toISOString()}
      >
        {format.dateTime(operation.createdAt, { timeStyle: "short" })}
      </time>
    </li>
  );
}

function FailureMessage({ code }: { code: ErrorCode | null }) {
  const fallback = useFallbackErrorMessage();
  const t = useTranslations(OPERATIONS_NAMESPACE);

  return (
    <span className="text-destructive text-xs">
      {code && isMappedCode(code) ? t(MESSAGE_KEYS[code]) : fallback()}
    </span>
  );
}

export function OperationsPanelSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      <Skeleton className="h-10 w-full motion-reduce:animate-none" />
      <Skeleton className="h-10 w-full motion-reduce:animate-none" />
      <Skeleton className="h-10 w-full motion-reduce:animate-none" />
    </div>
  );
}
