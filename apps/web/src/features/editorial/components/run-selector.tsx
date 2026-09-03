"use client";

import { useFormatter, useTranslations } from "next-intl";

import { LabeledSelect } from "@/components/form/form-field";

import { EDITORIAL_NAMESPACE } from "../constants";
import type { RunOption } from "../schemas/workspace";

export function RunSelector({
  isPending,
  onSelectRun,
  runs,
  selected,
}: {
  isPending: boolean;
  onSelectRun: (run: string | null) => void;
  runs: readonly RunOption[];
  selected: RunOption | null;
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  // A run reached by URL can sit outside the recent window the selector lists.
  const listed =
    selected === null || runs.some((run) => run.id === selected.id);
  const options = (
    listed || selected === null ? runs : [selected, ...runs]
  ).map((run) => ({
    label: t("run.selector.option", {
      kind: t(`run.kind.${run.kind}`),
      time: format.dateTime(run.startedAt, {
        dateStyle: "short",
        timeStyle: "medium",
      }),
    }),
    value: run.id,
  }));

  return (
    <LabeledSelect
      busy={isPending}
      emptyLabel={t("run.selector.latest")}
      label={t("run.selector.label")}
      onValueChange={onSelectRun}
      options={options}
      triggerClassName="w-full max-sm:min-h-11"
      value={selected?.id ?? null}
    />
  );
}
