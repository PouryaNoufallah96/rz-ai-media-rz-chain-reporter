"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import type { TableOptions } from "@tanstack/react-table";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { StateMark } from "@/components/common/state-mark";
import { CoreDataTable } from "@/components/data-table/data-table";
import { KeysetPagination } from "@/components/data-table/keyset-pagination";
import {
  type keysetDataTableFeatures,
  useKeysetDataTable,
} from "@/components/data-table/use-keyset-data-table";
import { LabeledSelect } from "@/components/form/form-field";
import { useAction } from "@/hooks/use-action";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";
import { Link } from "@/i18n/navigation";

import { discardCardAction, restoreCardAction } from "../actions/commands";
import { PUBLISHING_NAMESPACE } from "../constants";
import {
  type KeysetPage,
  type SavedHistoryRow,
  type SavedQuery,
  savedSearchParsers,
} from "../schemas/history";
import { PublishingFreshness } from "./publishing-freshness";

export function SavedTable({
  page,
  query,
}: {
  page: KeysetPage<SavedHistoryRow>;
  query: SavedQuery;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const format = useFormatter();
  const { isPending, setValues } = useTransitionUrlState(savedSearchParsers);
  const discard = useAction(discardCardAction);
  const restore = useAction(restoreCardAction);
  const [confirmRow, setConfirmRow] = useState<SavedHistoryRow | null>(null);
  const columns: TableOptions<
    typeof keysetDataTableFeatures,
    SavedHistoryRow
  >["columns"] = [
    {
      accessorKey: "savedAt",
      header: t("saved.columns.time"),
      cell: ({ row }) => {
        const savedAt = new Date(row.original.savedAt.valueOf());
        return (
          <time className="text-xs" dateTime={savedAt.toISOString()}>
            {format.dateTime(savedAt, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </time>
        );
      },
    },
    {
      id: "identity",
      header: t("saved.columns.card"),
      cell: ({ row }) => (
        <span className="grid min-w-44 gap-1">
          <strong>{row.original.brandName}</strong>
          <span className="text-muted-foreground text-xs">
            <Bdi>{row.original.platform}</Bdi> ·{" "}
            <Bdi>{row.original.originTitle}</Bdi>
          </span>
        </span>
      ),
    },
    {
      id: "revision",
      header: t("saved.columns.revision"),
      cell: ({ row }) => (
        <span className="flex items-center gap-1">
          <StateMark state={row.original.approved ? "succeeded" : "queued"} />
          {row.original.revisionNumber
            ? t("saved.revision", { n: row.original.revisionNumber })
            : t("saved.noRevision")}
        </span>
      ),
    },
    {
      id: "state",
      header: t("saved.columns.state"),
      cell: ({ row }) =>
        row.original.discardedAt ? t("saved.discarded") : t("saved.active"),
    },
    {
      id: "action",
      header: () => (
        <span className="sr-only">{t("saved.columns.action")}</span>
      ),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button
            nativeButton={false}
            render={
              <Link
                href={`/dashboard?run=${row.original.analysisRunId}&draft=${row.original.platformDraftId}`}
              />
            }
            size="xs"
            variant="outline"
          >
            {t("saved.reopen")}
          </Button>
          <Button
            onClick={() => setConfirmRow(row.original)}
            size="xs"
            type="button"
            variant="ghost"
          >
            {row.original.discardedAt ? t("saved.restore") : t("saved.discard")}
          </Button>
        </div>
      ),
    },
  ];
  const table = useKeysetDataTable({
    columns,
    data: page.rows,
    getRowId: (row) => row.id,
  });
  const confirm = async () => {
    if (!confirmRow) return { error: t("error.command") };
    const input = {
      savedCardId: confirmRow.id,
      expectedVersion: confirmRow.version,
      idempotencyKey: crypto.randomUUID(),
    };
    const result = confirmRow.discardedAt
      ? await restore.execute(input)
      : await discard.execute(input);
    return result.status === "error"
      ? { error: t("error.command") }
      : undefined;
  };
  return (
    <section className="mt-6" aria-labelledby="saved-ledger-title">
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 sm:p-4">
        <LabeledSelect
          label={t("saved.filter")}
          onValueChange={(state) =>
            setValues({ state: state ?? "active", cursor: null })
          }
          options={(["active", "discarded", "all"] as const).map((value) => ({
            label: t(`saved.filterState.${value}`),
            value,
          }))}
          value={query.state}
        />
        <div className="ms-auto">
          <PublishingFreshness />
        </div>
      </div>
      <h2 className="font-medium text-sm" id="saved-ledger-title">
        {t("saved.ledger")}
      </h2>
      <CoreDataTable
        isPending={isPending}
        labels={{
          caption: t("saved.caption"),
          empty: t("saved.empty"),
          updating: t("table.updating"),
        }}
        table={table}
      />
      <KeysetPagination
        backToLatestLabel={t("pager.latest")}
        newerLabel={t("pager.newer")}
        olderLabel={t("pager.older")}
        offLatest={page.offLatest}
        onBackToLatest={() => setValues({ cursor: null })}
        onNewer={() => setValues({ cursor: page.newerCursor })}
        onOlder={
          page.olderCursor
            ? () => setValues({ cursor: page.olderCursor })
            : null
        }
      />
      <ConfirmDialog
        cancelLabel={t("confirm.cancel")}
        confirmLabel={
          confirmRow?.discardedAt ? t("saved.restore") : t("saved.discard")
        }
        description={t("saved.confirmDescription")}
        fallbackError={t("error.command")}
        onConfirm={confirm}
        onOpenChange={(open) => !open && setConfirmRow(null)}
        open={confirmRow !== null}
        pendingLabel={t("ticket.pending")}
        title={t("saved.confirmTitle")}
      />
    </section>
  );
}
