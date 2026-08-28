"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { useTranslations } from "next-intl";

import { USAGE_NAMESPACE } from "../constants";
import { useUsageFreshness } from "../hooks/use-usage-freshness";

export function UsageFreshness() {
  const t = useTranslations(USAGE_NAMESPACE);
  const { isRefreshing, refresh, transport } = useUsageFreshness();

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span
        className="wrap-break-word min-w-0 text-muted-foreground text-xs tabular-nums"
        role="status"
      >
        {t(`transport.${transport}`)}
      </span>
      <Button
        aria-busy={isRefreshing}
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
