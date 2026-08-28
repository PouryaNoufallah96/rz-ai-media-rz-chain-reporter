"use client";

import { DIRECTION } from "@rz-chain-reporter/i18n";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rz-chain-reporter/ui/components/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { CONTENT_HASH_DISPLAY_LENGTH, SOURCES_NAMESPACE } from "../constants";
import type { SourceItemRow } from "../schemas/stream";

export function SourceItemDetail({ row }: { row: SourceItemRow }) {
  const t = useTranslations(SOURCES_NAMESPACE);

  return (
    <Collapsible>
      <CollapsibleTrigger
        render={
          <Button
            className="group h-auto max-w-60 justify-start whitespace-normal text-start"
            size="xs"
            variant="ghost"
          />
        }
      >
        <ChevronDownIcon className="shrink-0 transition-transform group-data-panel-open:rotate-180" />
        {t("detail.open", { name: row.title })}
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted className="data-closed:hidden">
        <dl className="mt-2 grid min-w-64 gap-3 rounded-lg border bg-muted/30 p-3 text-xs">
          <Detail label={t("detail.hash")}>
            <Bdi dir="ltr" className="font-mono">
              {row.contentHash.slice(0, CONTENT_HASH_DISPLAY_LENGTH)}
            </Bdi>
          </Detail>
          <Detail label={t("detail.contentLocale")}>
            <span className="font-mono">{row.contentLocale}</span>
          </Detail>
          {row.adapter === "firecrawl" && row.fallbackReason ? (
            <Detail label={t("detail.adapter")}>
              {`${t("adapter.directThenFirecrawl")} · ${t("adapter.fallbackReason", { reason: t(`reason.${row.fallbackReason}`) })}`}
            </Detail>
          ) : null}
          {row.enrichment === "unknown" ? (
            <div>
              <dt className="sr-only">{t("detail.brief")}</dt>
              <dd className="text-muted-foreground">
                {t("enrichment.unknownNote")}
              </dd>
            </div>
          ) : null}
          {row.brief ? (
            <Detail label={t("detail.brief")}>
              <div
                className="flex max-w-[72ch] flex-col gap-2 text-start text-sm/relaxed"
                dir={DIRECTION[row.contentLocale]}
                lang={row.contentLocale}
              >
                {row.brief.map((paragraph) => (
                  <p key={paragraph}>
                    <Bdi>{paragraph}</Bdi>
                  </p>
                ))}
              </div>
            </Detail>
          ) : null}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Detail({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="wrap-anywhere min-w-0">{children}</dd>
    </div>
  );
}
