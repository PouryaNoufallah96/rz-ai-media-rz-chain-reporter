"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { useTranslations } from "next-intl";

import { SOURCES_NAMESPACE } from "../constants";
import { useSourcesFreshness } from "../hooks/use-sources-freshness";

export function SourcesFreshness() {
  const t = useTranslations(SOURCES_NAMESPACE);
  const { isRefreshing, refresh, transport } = useSourcesFreshness();

  return (
    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
      <span
        className="wrap-break-word min-w-0 font-mono text-muted-foreground text-xs tabular-nums"
        role="status"
      >
        {t(`transport.${transport}`)}
      </span>
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
