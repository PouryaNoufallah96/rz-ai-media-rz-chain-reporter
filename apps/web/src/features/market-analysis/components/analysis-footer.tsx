"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { MetalButton } from "@rz-chain-reporter/ui/components/metal-button";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { ChevronLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";

import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { useAnalysisFooterSlot } from "./analysis-workspace-frame";

export function AnalysisFooter({
  disabled = false,
  form,
  onBack,
  onPrimary,
  pending = false,
  pendingLabel,
  primaryLabel,
  primaryValue,
}: {
  disabled?: boolean;
  form?: string;
  onBack?: () => void;
  onPrimary?: () => void;
  pending?: boolean;
  pendingLabel?: string;
  primaryLabel: string;
  primaryValue?: string;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const slot = useAnalysisFooterSlot();
  if (!slot) return null;
  return createPortal(
    <div className="workspace:sticky bottom-5 z-10 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10 max-workspace:pe-16 sm:bottom-6">
      <Button
        disabled={!onBack || pending}
        onClick={onBack}
        type="button"
        variant="outline"
      >
        <ChevronLeftIcon
          aria-hidden="true"
          className="rtl:-scale-x-100"
          data-icon="inline-start"
        />
        {t("shell.back")}
      </Button>
      <MetalButton
        aria-busy={pending}
        disabled={disabled || pending}
        form={form}
        onClick={onPrimary}
        paused={pending}
        type={form ? "submit" : "button"}
        value={primaryValue}
      >
        {pending ? (
          <Spinner data-icon="inline-start" label={pendingLabel} />
        ) : null}
        {pending ? pendingLabel : primaryLabel}
      </MetalButton>
    </div>,
    slot,
  );
}
