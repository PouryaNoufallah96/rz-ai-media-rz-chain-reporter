"use client";

import { isOperationInProgress } from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Hint } from "@rz-chain-reporter/ui/components/hint";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import type { TranslationStatus } from "../schemas/workspace";

type TranslationActionCopy = {
  translate: string;
  queueing: string;
  translating: string;
  unknown: string;
  retry: string;
  text: string;
  hint: {
    translate: string;
    queueing: string;
    translating: string;
    retry: string;
  };
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

  const { failed, hint, label, pending } = resolveTranslationAction(
    copy,
    isActionPending,
    status,
  );

  return (
    <Hint label={hint}>
      <Button
        aria-busy={pending || undefined}
        aria-label={label}
        className={
          failed
            ? "h-5 px-1.5 text-[11px] text-destructive"
            : "h-5 px-1.5 text-[11px]"
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
    </Hint>
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
      hint: copy.hint.queueing,
      label: copy.queueing,
      pending: true,
    };
  }
  if (translating) {
    return {
      failed,
      hint: copy.hint.translating,
      label: copy.translating,
      pending: true,
    };
  }
  if (status?.lifecycle === "unknown") {
    return {
      failed,
      hint: copy.hint.retry,
      label: copy.unknown,
      pending: false,
    };
  }

  return {
    failed,
    hint: failed ? copy.hint.retry : copy.hint.translate,
    label: failed ? copy.retry : copy.translate,
    pending: false,
  };
}
