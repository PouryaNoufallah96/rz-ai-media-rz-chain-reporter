"use client";

import { isOperationInProgress } from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import type { TranslationStatus } from "../schemas/workspace";

type TranslationActionCopy = {
  translate: string;
  queueing: string;
  translating: string;
  unknown: string;
  retry: string;
  text: string;
};

export function TranslationActionButton({
  available,
  copy,
  isActionPending,
  onTranslate,
  status,
}: {
  available: boolean;
  copy: TranslationActionCopy;
  isActionPending: boolean;
  onTranslate: () => Promise<void>;
  status: TranslationStatus | null;
}) {
  if (available) return null;

  const { failed, label, pending } = resolveTranslationAction(
    copy,
    isActionPending,
    status,
  );

  return (
    <Button
      aria-busy={pending || undefined}
      aria-label={label}
      className={
        failed
          ? "px-1.5 text-destructive max-compact:min-h-11"
          : "px-1.5 max-compact:min-h-11"
      }
      disabled={pending}
      onClick={onTranslate}
      size="xs"
      type="button"
      variant="ghost"
    >
      {pending ? <Spinner label={label} /> : null}
      {copy.text}
    </Button>
  );
}

function resolveTranslationAction(
  copy: TranslationActionCopy,
  isActionPending: boolean,
  status: TranslationStatus | null,
) {
  const translating =
    isOperationInProgress(status?.lifecycle) &&
    (status.lifecycle !== "queued" || status.dispatchState !== "exhausted");
  const failed = status !== null && !translating;

  if (isActionPending) {
    return {
      failed,
      label: copy.queueing,
      pending: true,
    };
  }
  if (translating) {
    return {
      failed,
      label: copy.translating,
      pending: true,
    };
  }
  if (status?.lifecycle === "unknown") {
    return {
      failed,
      label: copy.unknown,
      pending: false,
    };
  }

  return {
    failed,
    label: failed ? copy.retry : copy.translate,
    pending: false,
  };
}
