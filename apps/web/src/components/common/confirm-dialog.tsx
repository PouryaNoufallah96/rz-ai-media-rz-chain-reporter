"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { FieldError } from "@rz-chain-reporter/ui/components/field";
import {
  ResponsiveModal,
  ResponsiveModalClose,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@rz-chain-reporter/ui/components/responsive-modal";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { useState, useTransition } from "react";

type ConfirmOutcome = { error: string } | undefined;

interface ConfirmDialogProps {
  cancelLabel: string;
  confirmLabel: string;
  description?: string;
  fallbackError: string;
  onConfirm: () => ConfirmOutcome | Promise<ConfirmOutcome>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pendingLabel: string;
  title: string;
  variant?: "default" | "destructive";
}

export function ConfirmDialog({
  cancelLabel,
  confirmLabel,
  description,
  fallbackError,
  onConfirm,
  onOpenChange,
  open,
  pendingLabel,
  title,
  variant = "default",
}: ConfirmDialogProps) {
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const locked = isPending && variant === "destructive";

  const confirm = () => {
    setError(undefined);
    startTransition(async () => {
      let outcome: ConfirmOutcome;
      try {
        outcome = await onConfirm();
      } catch {
        setError(fallbackError);
        return;
      }

      if (outcome?.error) {
        setError(outcome.error);
        return;
      }

      onOpenChange(false);
    });
  };

  return (
    <ResponsiveModal
      disablePointerDismissal={locked}
      onOpenChange={(next) => {
        if (locked) {
          return;
        }
        if (next) {
          setError(undefined);
        }
        onOpenChange(next);
      }}
      open={open}
    >
      <ResponsiveModalContent aria-busy={isPending} className="max-w-sm">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{title}</ResponsiveModalTitle>
          <ResponsiveModalDescription
            className={description ? undefined : "sr-only"}
          >
            {description ?? title}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <FieldError>{error}</FieldError>
        <ResponsiveModalFooter>
          <ResponsiveModalClose
            disabled={locked}
            render={<Button variant="outline" />}
          >
            {cancelLabel}
          </ResponsiveModalClose>
          <Button
            aria-busy={isPending}
            disabled={isPending}
            onClick={confirm}
            variant={variant}
          >
            {isPending ? (
              <Spinner data-icon="inline-start" label={pendingLabel} />
            ) : null}
            {confirmLabel}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
