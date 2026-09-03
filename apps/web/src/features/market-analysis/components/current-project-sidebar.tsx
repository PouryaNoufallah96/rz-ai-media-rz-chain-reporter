"use client";

import type {
  ContentLocale,
  MarketOutputFormat,
  MarketPeriod,
  MarketScale,
} from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import {
  ClockIcon,
  LanguagesIcon,
  LayoutTemplateIcon,
  PaletteIcon,
  ScalingIcon,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { StateMark, type StateMarkState } from "@/components/common/state-mark";

import { MARKET_ANALYSIS_NAMESPACE } from "../constants";

export function CurrentProjectSidebar({
  children,
  comparisons,
  contentLocale,
  icon,
  outputFormat,
  owner,
  period,
  preview,
  primaries,
  scale,
  status,
}: {
  children?: ReactNode;
  comparisons: readonly string[];
  contentLocale: ContentLocale;
  icon: { url: string; width: number; height: number } | null;
  outputFormat: MarketOutputFormat;
  owner: string;
  period: MarketPeriod;
  preview?: ReactNode;
  primaries: readonly string[];
  scale: MarketScale;
  status: { label: string; state: StateMarkState };
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  return (
    <section
      aria-label={t("shell.project")}
      className="flex min-w-0 flex-col gap-4 p-4"
    >
      {preview}
      <div className="grid min-w-0 gap-2">
        <span className="ticket-label text-muted-foreground">
          {t("shell.project")}
        </span>
        <div className="flex min-w-0 items-center gap-2">
          {icon ? (
            <Image
              alt=""
              className="size-8 shrink-0 rounded-md object-contain"
              height={icon.height}
              src={icon.url}
              unoptimized
              width={icon.width}
            />
          ) : null}
          <div className="grid min-w-0">
            <Bdi className="truncate font-medium text-sm">
              {primaries.join(" · ") || "—"}
            </Bdi>
            <Bdi className="truncate text-muted-foreground text-xs">
              {comparisons.length > 0
                ? t("shell.versus", { names: comparisons.join(" · ") })
                : t("create.noComparisons")}
            </Bdi>
          </div>
        </div>
      </div>
      <dl className="grid gap-2 text-sm">
        <ProjectRow
          icon={<PaletteIcon aria-hidden="true" className="size-4" />}
          label={t("shell.owner")}
          value={owner || "—"}
        />
        <ProjectRow
          icon={<ClockIcon aria-hidden="true" className="size-4" />}
          label={t("shell.period")}
          value={t(`create.periods.${period}`)}
        />
        <ProjectRow
          icon={<ScalingIcon aria-hidden="true" className="size-4" />}
          label={t("shell.scale")}
          value={t(`create.scales.${scale}`)}
        />
        <ProjectRow
          icon={<LayoutTemplateIcon aria-hidden="true" className="size-4" />}
          label={t("shell.output")}
          value={t(`create.formats.${outputFormat}`)}
        />
        <ProjectRow
          icon={<LanguagesIcon aria-hidden="true" className="size-4" />}
          label={t("shell.contentLocale")}
          value={t(`create.locales.${contentLocale}`)}
        />
        <ProjectRow
          icon={<StateMark state={status.state} />}
          label={t("shell.status")}
          value={status.label}
        />
      </dl>
      {children}
    </section>
  );
}

export function ProjectRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="grid min-w-0 gap-0.5">
        <dt className="ticket-label text-muted-foreground">{label}</dt>
        <dd className="min-w-0 font-medium text-xs">
          <Bdi>{value}</Bdi>
        </dd>
      </div>
    </div>
  );
}
