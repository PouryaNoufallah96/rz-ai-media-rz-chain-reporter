"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useId } from "react";

import { useTransitionUrlState } from "@/hooks/use-transition-url-state";

import { EDITORIAL_NAMESPACE } from "../constants";
import { type RunOption, workspaceSearchParsers } from "../schemas/workspace";

export const SHORT_ID_LENGTH = 8;

export function RunSelector({
  runs,
  selected,
}: {
  runs: readonly RunOption[];
  selected: RunOption | null;
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const controlId = useId();
  const { isPending, setValues } = useTransitionUrlState(
    workspaceSearchParsers,
  );
  // A run reached by URL can sit outside the recent window the selector lists.
  const listed =
    selected === null || runs.some((run) => run.id === selected.id);

  return (
    <div aria-busy={isPending} className="grid gap-1">
      <label className="ticket-label" htmlFor={controlId}>
        {t("run.selector.label")}
      </label>
      <select
        className="h-8 w-full rounded-none border border-input bg-background px-2 text-xs"
        data-pending={isPending || undefined}
        id={controlId}
        onChange={(event) =>
          setValues({
            run: event.target.value === "" ? null : event.target.value,
          })
        }
        value={selected?.id ?? ""}
      >
        <option value="">{t("run.selector.latest")}</option>
        {(listed ? runs : [selected, ...runs]).map((run) => (
          <option key={run.id} value={run.id}>
            {t("run.selector.option", {
              actor: run.mine ? t("run.selector.you") : run.actorName,
              id: run.id.slice(0, SHORT_ID_LENGTH),
              kind: t(`run.kind.${run.kind}`),
              time: format.dateTime(run.startedAt, {
                dateStyle: "short",
                timeStyle: "medium",
              }),
            })}
          </option>
        ))}
      </select>
    </div>
  );
}
