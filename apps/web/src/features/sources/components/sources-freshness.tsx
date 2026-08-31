"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { useFormatter, useTranslations } from "next-intl";

import { SOURCES_NAMESPACE } from "../constants";
import { useSourcesFreshness } from "../hooks/use-sources-freshness";

export function SourcesFreshness({ readAt }: { readAt: Date }) {
  const format = useFormatter();
  const t = useTranslations(SOURCES_NAMESPACE);
  const { isRefreshing, refresh, transport } = useSourcesFreshness();

  return (
    <div className="ms-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-none">
        <span
          className="wrap-break-word min-w-0 text-muted-foreground text-xs tabular-nums"
          role="status"
        >
          {t(`transport.${transport}`)}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("import.asOf", {
            time: format.dateTime(readAt, { timeStyle: "medium" }),
          })}
        </span>
      </div>
      <Button
        aria-busy={isRefreshing}
        className="max-sm:min-h-11"
        disabled={isRefreshing}
        onClick={refresh}
        size="xs"
        type="button"
        variant="ghost"
      >
        {t("transport.refresh")}
      </Button>
    </div>
  );
}
