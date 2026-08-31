"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { operationCreated } from "@/features/operations/lib/focus-operation";
import { useAction } from "@/hooks/use-action";

import {
  cancelScheduledPublicationAction,
  reschedulePublicationAction,
} from "../actions/commands";
import { PUBLISHING_NAMESPACE } from "../constants";
import {
  minimumLocalTime,
  validFutureLocalTime,
  zonedLocalDate,
} from "../lib/installation-time";
import type { PublishingHistoryRow } from "../schemas/history";
import { PublishingDateTimePicker } from "./publishing-date-time-picker";

type ScheduledIntent = "cancel" | "reschedule";

export function ScheduledPublicationActions({
  installationTimeZone,
  row,
}: {
  installationTimeZone: string;
  row: PublishingHistoryRow;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const format = useFormatter();
  const cancel = useAction(cancelScheduledPublicationAction);
  const reschedule = useAction(reschedulePublicationAction);
  const [localTime, setLocalTime] = useState(() =>
    minimumLocalTime(installationTimeZone),
  );
  const [intent, setIntent] = useState<ScheduledIntent | null>(null);
  const scheduledAt = zonedLocalDate(localTime, installationTimeZone);
  const scheduleId = row.scheduleId;

  if (row.lifecycle !== "scheduled" || !scheduleId) return null;

  const confirm = async () => {
    const result =
      intent === "cancel"
        ? await cancel.execute({
            scheduleId,
            expectedVersion: row.version,
            idempotencyKey: crypto.randomUUID(),
          })
        : intent === "reschedule" && scheduledAt
          ? await reschedule.execute({
              scheduleId,
              expectedVersion: row.version,
              scheduledAt: scheduledAt.toISOString(),
              idempotencyKey: crypto.randomUUID(),
            })
          : null;
    if (result?.status !== "success") {
      return { error: t("error.command") };
    }
    if (
      result.data &&
      "operationId" in result.data &&
      result.data.status === "created"
    ) {
      operationCreated(result.data.operationId);
    }
    return undefined;
  };
  const facts = {
    account: row.destinationLabel,
    n: row.revisionNumber,
    platform: t(`platform.${row.platform}`),
  };
  const confirmationDescription =
    intent === "reschedule" && scheduledAt
      ? t("desk.confirmRescheduleDescription", {
          ...facts,
          instant: format.dateTime(scheduledAt, {
            dateStyle: "full",
            timeStyle: "long",
            timeZone: installationTimeZone,
          }),
          timeZone: installationTimeZone,
        })
      : t("desk.confirmRecordDescription", facts);

  return (
    <div className="grid min-w-52 gap-2 rounded-lg border bg-muted/20 p-3">
      <PublishingDateTimePicker
        label={t("schedule.rescheduleTime")}
        onValueChange={setLocalTime}
        timeZone={installationTimeZone}
        value={localTime}
      />
      {scheduledAt ? (
        <p className="text-muted-foreground text-xs/relaxed">
          {format.dateTime(scheduledAt, {
            dateStyle: "full",
            timeStyle: "long",
            timeZone: installationTimeZone,
          })}{" "}
          · {installationTimeZone}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 sm:min-h-6"
          onClick={() => setIntent("cancel")}
          size="xs"
          type="button"
          variant="ghost"
        >
          {t("action.cancel")}
        </Button>
        <Button
          className="min-h-11 sm:min-h-6"
          disabled={!validFutureLocalTime(localTime, installationTimeZone)}
          onClick={() => setIntent("reschedule")}
          size="xs"
          type="button"
          variant="outline"
        >
          {t("action.reschedule")}
        </Button>
      </div>
      <ConfirmDialog
        cancelLabel={t("confirm.cancel")}
        confirmLabel={
          intent === "cancel" ? t("action.cancel") : t("action.reschedule")
        }
        description={confirmationDescription}
        fallbackError={t("error.command")}
        onConfirm={confirm}
        onOpenChange={(open) => !open && setIntent(null)}
        open={intent !== null}
        pendingLabel={t("ticket.pending")}
        title={t("confirm.title")}
      />
    </div>
  );
}
