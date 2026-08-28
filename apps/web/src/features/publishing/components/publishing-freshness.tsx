"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { useTranslations } from "next-intl";

import { PUBLISHING_NAMESPACE } from "../constants";
import { usePublishingFreshness } from "../hooks/use-publishing-freshness";

export function PublishingFreshness() {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const { freshness, isRefreshing, refresh } = usePublishingFreshness();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-xs" role="status">
        {t(`freshness.${freshness}`)}
      </span>
      <Button
        aria-busy={isRefreshing}
        disabled={isRefreshing}
        onClick={refresh}
        size="xs"
        type="button"
        variant="outline"
      >
        {t(isRefreshing ? "freshness.refreshing" : "freshness.refresh")}
      </Button>
    </div>
  );
}
