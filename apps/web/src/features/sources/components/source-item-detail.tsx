"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { CONTENT_HASH_DISPLAY_LENGTH, SOURCES_NAMESPACE } from "../constants";
import type { SourceItemRow } from "../schemas/stream";

export function SourceItemDetail({ row }: { row: SourceItemRow }) {
  const format = useFormatter();
  const t = useTranslations(SOURCES_NAMESPACE);

  return (
    <details>
      <summary className="cursor-pointer select-none text-xs">
        {t("detail.open", { name: row.title })}
      </summary>
      <dl className="mt-2 grid gap-1 text-xs">
        <Detail label={t("detail.revisions")}>
          <span className="font-mono tabular-nums">
            {format.number(row.revisionCount)}
          </span>
        </Detail>
        <Detail label={t("detail.hash")}>
          <Bdi dir="ltr" className="font-mono">
            {row.contentHash.slice(0, CONTENT_HASH_DISPLAY_LENGTH)}
          </Bdi>
        </Detail>
        <Detail label={t("detail.contentLocale")}>
          <span className="font-mono">{row.contentLocale}</span>
        </Detail>
        <Detail label={t("detail.enrichment")}>
          {row.enrichmentReason
            ? `${t(`enrichment.${row.enrichment ?? "none"}`)} — ${t(`reason.${row.enrichmentReason}`)}`
            : t(`enrichment.${row.enrichment ?? "none"}`)}
        </Detail>
        {row.adapter ? (
          <Detail label={t("detail.adapter")}>
            {row.adapter === "firecrawl" && row.fallbackReason
              ? `${t("adapter.directThenFirecrawl")} · ${t("adapter.fallbackReason", { reason: t(`reason.${row.fallbackReason}`) })}`
              : t(`adapter.${row.adapter}`)}
          </Detail>
        ) : null}
        {row.enrichment === "unknown" ? (
          <p className="text-muted-foreground">{t("enrichment.unknownNote")}</p>
        ) : null}
        {row.brief ? (
          <Detail label={t("detail.brief")}>
            <div className="flex max-w-[72ch] flex-col gap-1 text-sm">
              {row.brief.map((paragraph) => (
                <p key={paragraph}>
                  <Bdi>{paragraph}</Bdi>
                </p>
              ))}
            </div>
          </Detail>
        ) : null}
      </dl>
    </details>
  );
}

function Detail({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
