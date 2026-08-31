"use client";

import { isOperationInProgress } from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Hint } from "@rz-chain-reporter/ui/components/hint";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { LanguagesIcon } from "lucide-react";

import type { TranslationStatus } from "../schemas/workspace";

type TranslationActionCopy = {
  translate: string;
  queueing: string;
  translating: string;
  unknown: string;
  retry: string;
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

  const translating =
    isOperationInProgress(status?.lifecycle) &&
    (status.lifecycle !== "queued" || status.dispatchState !== "exhausted");
  const pending = isActionPending || translating;
  const failed = status !== null && !translating;
  const label = isActionPending
    ? copy.queueing
    : translating
      ? copy.translating
      : status?.lifecycle === "unknown"
        ? copy.unknown
        : failed
          ? copy.retry
          : copy.translate;
  const hint = isActionPending
    ? copy.hint.queueing
    : translating
      ? copy.hint.translating
      : failed
        ? copy.hint.retry
        : copy.hint.translate;

  return (
    <Hint label={hint}>
      <Button
        aria-busy={pending || undefined}
        aria-label={label}
        className={
          failed
            ? "text-destructive max-compact:size-11"
            : "max-compact:size-11"
        }
        disabled={pending}
        onClick={onTranslate}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {pending ? (
          <Spinner label={label} />
        ) : (
          <LanguagesIcon aria-hidden="true" />
        )}
      </Button>
    </Hint>
  );
}
