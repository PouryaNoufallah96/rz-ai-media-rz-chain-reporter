"use client";

import type { OperationLifecycle } from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { RefreshCwIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { EDITORIAL_NAMESPACE } from "../constants";
import { useEditorialFreshness } from "../hooks/use-editorial-freshness";
import type { FreshnessOperation } from "../lib/editorial-freshness";

export function EditorialFreshness({
  analysisRunId,
  compact = false,
  copyOperation,
  lifecycle,
  platformDraftId,
  readAt,
}: {
  analysisRunId: string;
  compact?: boolean;
  copyOperation?: FreshnessOperation | null;
  lifecycle: OperationLifecycle;
  platformDraftId?: string;
  readAt: Date;
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { isRefreshing, refresh, transport } = useEditorialFreshness(
    analysisRunId,
    lifecycle,
    compact,
    platformDraftId ?? null,
    copyOperation ?? null,
  );

  if (compact) {
    return (
      <div className="ms-auto flex min-w-0 items-center gap-1">
        <span
          aria-live="polite"
          className="truncate text-muted-foreground text-xs"
        >
          {transport === "live"
            ? t("cardSheet.live")
            : t(`transport.${transport}`)}
        </span>
        <Button
          aria-busy={isRefreshing}
          aria-label={
            isRefreshing ? t("transport.refreshing") : t("transport.refresh")
          }
          disabled={isRefreshing}
          onClick={refresh}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {isRefreshing ? (
            <Spinner label={t("transport.refreshing")} />
          ) : (
            <RefreshCwIcon aria-hidden="true" />
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-border border-b py-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="wrap-break-word min-w-0 text-muted-foreground text-xs tabular-nums">
          {t(`transport.${transport}`)}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("transport.asOf", {
            time: format.dateTime(readAt, {
              dateStyle: "short",
              timeStyle: "medium",
            }),
          })}
        </span>
      </div>
      <Button
        aria-busy={isRefreshing}
        disabled={isRefreshing}
        onClick={refresh}
        className="max-sm:min-h-11"
        size="xs"
        type="button"
        variant="ghost"
      >
        {t("transport.refresh")}
      </Button>
    </div>
  );
}
