"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import type { TableOptions } from "@tanstack/react-table";
import { useFormatter, useTranslations } from "next-intl";

import { CoreDataTable } from "@/components/data-table/data-table";
import { KeysetPagination } from "@/components/data-table/keyset-pagination";
import {
  type keysetDataTableFeatures,
  useKeysetDataTable,
} from "@/components/data-table/use-keyset-data-table";
import type { KeysetPage } from "@/features/publishing/schemas/history";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";

import { ACCOUNT_NAMESPACE, ACTIVITY_MESSAGE } from "../constants";
import type { ActivityLedgerRow } from "../schemas/account";
import { accountSearchParsers } from "../schemas/search";

export function ActivityLedger({
  page,
}: {
  page: KeysetPage<ActivityLedgerRow>;
}) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  const format = useFormatter();
  const { isPending, setValues } = useTransitionUrlState(accountSearchParsers);
  const columns: TableOptions<
    typeof keysetDataTableFeatures,
    ActivityLedgerRow
  >["columns"] = [
    {
      accessorKey: "occurredAt",
      header: t("audit.columns.time"),
      cell: ({ row }) => {
        const occurredAt = new Date(row.original.occurredAt.valueOf());
        return (
          <time className="text-xs" dateTime={occurredAt.toISOString()}>
            {format.dateTime(occurredAt, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </time>
        );
      },
    },
    {
      id: "actor",
      header: t("audit.columns.actor"),
      cell: ({ row }) =>
        (row.original.actorName ?? row.original.actorEmail) ? (
          <span className="grid min-w-32 gap-0.5">
            {row.original.actorName ? (
              <strong className="wrap-anywhere">
                <Bdi>{row.original.actorName}</Bdi>
              </strong>
            ) : null}
            {row.original.actorEmail ? (
              <span className="wrap-anywhere text-muted-foreground text-xs">
                <Bdi>{row.original.actorEmail}</Bdi>
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("audit.system")}</span>
        ),
    },
    {
      id: "event",
      header: t("audit.columns.event"),
      cell: ({ row }) => t(ACTIVITY_MESSAGE[row.original.eventType]),
    },
    {
      id: "record",
      header: t("audit.columns.record"),
      cell: ({ row }) => (
        <span className="grid min-w-40 gap-0.5">
          <span>{t(`audit.records.${row.original.recordKind}`)}</span>
          <Bdi className="wrap-anywhere font-mono text-muted-foreground text-xs tabular-nums">
            {row.original.recordId}
          </Bdi>
        </span>
      ),
    },
  ];
  const table = useKeysetDataTable({
    columns,
    data: page.rows,
    getRowId: (row) => row.id,
  });

  return (
    <section aria-labelledby="account-audit-title" className="mt-6 min-w-0">
      <h2 className="font-medium text-sm" id="account-audit-title">
        {t("audit.title")}
      </h2>
      <p className="mt-1 mb-3 max-w-3xl text-muted-foreground text-xs">
        {t("audit.description")}
      </p>
      <div className="overflow-x-auto">
        <CoreDataTable
          isPending={isPending}
          labels={{
            caption: t("audit.caption"),
            empty: t("audit.empty"),
            updating: t("audit.updating"),
          }}
          table={table}
        />
      </div>
      <KeysetPagination
        backToLatestLabel={t("audit.latest")}
        newerLabel={t("audit.newer")}
        offLatest={page.offLatest}
        olderLabel={t("audit.older")}
        onBackToLatest={() => setValues({ auditCursor: null })}
        onNewer={() => setValues({ auditCursor: page.newerCursor })}
        onOlder={
          page.olderCursor
            ? () => setValues({ auditCursor: page.olderCursor })
            : null
        }
      />
    </section>
  );
}
