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
