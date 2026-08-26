"use client";

import type { OperationLifecycle } from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { useFormatter, useTranslations } from "next-intl";

import { EDITORIAL_NAMESPACE } from "../constants";
import { useEditorialFreshness } from "../hooks/use-editorial-freshness";

export function EditorialFreshness({
  analysisRunId,
  lifecycle,
  readAt,
}: {
  analysisRunId: string;
  lifecycle: OperationLifecycle;
  readAt: Date;
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { isRefreshing, refresh, transport } = useEditorialFreshness(
    analysisRunId,
    lifecycle,
  );

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-border border-b border-dashed py-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="wrap-break-word min-w-0 font-mono text-muted-foreground text-xs tabular-nums">
          {isRefreshing
            ? t("transport.refreshing")
            : t(`transport.${transport}`)}
        </span>
        <span className="font-mono text-muted-foreground text-xs tabular-nums">
          {t("transport.asOf", {
            time: format.dateTime(readAt, {
              dateStyle: "short",
              timeStyle: "medium",
            }),
          })}
        </span>
      </div>
      <Button
        disabled={isRefreshing}
        onClick={refresh}
        size="xs"
        type="button"
        variant="outline"
      >
        {isRefreshing ? t("transport.refreshing") : t("transport.refresh")}
      </Button>
    </div>
  );
}
