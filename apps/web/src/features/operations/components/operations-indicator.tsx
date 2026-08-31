"use client";

import type { OperationStatusRealtimeMessage } from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@rz-chain-reporter/ui/components/sheet";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useState } from "react";
import { authClient } from "@/features/auth/lib/auth-client";
import { OPERATIONS_NAMESPACE } from "../constants";
import { useOperationsList } from "../hooks/use-operations-list";
import {
  type RealtimeTransport,
  useOperationsRealtime,
} from "../hooks/use-operations-realtime";
import {
  subscribeToOperationCreated,
  subscribeToOperationFocus,
} from "../lib/focus-operation";
import { edgeToneOf, type PanelState, panelStateOf } from "../lib/panel-state";
import { ColorBar } from "./color-bar";
import { OperationsPanel, OperationsPanelSkeleton } from "./operations-panel";

export function OperationsIndicator() {
  const { data: session } = authClient.useSession();

  if (!session) {
    return null;
  }

  return (
    <AuthenticatedOperationsIndicator
      key={session.user.id}
      viewerId={session.user.id}
    />
  );
}

function AuthenticatedOperationsIndicator({ viewerId }: { viewerId: string }) {
  const t = useTranslations(OPERATIONS_NAMESPACE);
  const [open, setOpen] = useState(false);
  const [focusedOperationId, setFocusedOperationId] = useState<string>();
  const operations = useOperationsList(viewerId, focusedOperationId);
  const realtime = useOperationsRealtime({
    isFetching: operations.isFetching,
    refetch: operations.refetch,
    viewerId,
  });
  const refreshOperations = useEffectEvent(realtime.refresh);
  const states = (operations.data ?? []).map(panelStateOf);
  const barTone =
    realtime.transport === "live" ? (edgeToneOf(states) ?? "idle") : "offline";

  useEffect(
    () =>
      subscribeToOperationFocus((operationId) => {
        setFocusedOperationId(operationId);
        setOpen(true);
      }),
    [],
  );

  useEffect(() => subscribeToOperationCreated(refreshOperations), []);

  return (
    <>
      <Sheet
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFocusedOperationId(undefined);
        }}
        open={open}
      >
        <SheetTrigger
          render={
            <Button
              className="max-w-full max-sm:min-h-11 max-sm:min-w-11"
              size="sm"
              variant="ghost"
            />
          }
        >
          <span className="flex items-center gap-1.5">
            <ColorBar tone={barTone} />
            <span className="hidden text-muted-foreground text-xs sm:inline">
              {t("panel.title")}
            </span>
          </span>
          <span className="sr-only sm:hidden">{t("indicator.label")}</span>
        </SheetTrigger>
        <SheetContent className="min-w-0" closeLabel={t("panel.close")}>
          <SheetHeader className="pe-8">
            <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <SheetTitle>{t("panel.title")}</SheetTitle>
              <TransportReadout
                isFetching={realtime.isRefreshing}
                onRefresh={() => {
                  realtime.refresh();
                  realtime.retry();
                }}
                snapshotAt={
                  operations.dataUpdatedAt
                    ? new Date(operations.dataUpdatedAt)
                    : null
                }
                transport={realtime.transport}
              />
            </div>
          </SheetHeader>
          {operations.isPending ? (
            <OperationsPanelSkeleton />
          ) : (
            <OperationsPanel
              focusedOperationId={focusedOperationId}
              isError={operations.isError}
              isFetching={operations.isFetching}
              operations={operations.data ?? []}
            />
          )}
        </SheetContent>
      </Sheet>
      <LiveRegion
        announcement={realtime.announcement}
        transport={realtime.transport}
      />
      <TransportBand transport={realtime.transport} />
    </>
  );
}

function TransportReadout({
  isFetching,
  onRefresh,
  snapshotAt,
  transport,
}: {
  isFetching: boolean;
  onRefresh: () => void;
  snapshotAt: Date | null;
  transport: RealtimeTransport;
}) {
  const format = useFormatter();
  const t = useTranslations(OPERATIONS_NAMESPACE);
  const readout =
    transport === "stale" && snapshotAt
      ? t("transport.asOf", {
          time: format.dateTime(snapshotAt, { timeStyle: "short" }),
        })
      : t(`transport.${transport}`);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:**:data-[slot=button]:min-h-11 max-sm:**:data-[slot=button]:min-w-11">
      <span className="wrap-break-word min-w-0 text-muted-foreground text-xs tabular-nums">
        {readout}
      </span>
      {transport === "live" ? null : (
        <Button
          disabled={isFetching}
          onClick={onRefresh}
          size="xs"
          type="button"
          variant="outline"
        >
          {t("transport.refresh")}
        </Button>
      )}
    </div>
  );
}

function TransportBand({ transport }: { transport: RealtimeTransport }) {
  const t = useTranslations(OPERATIONS_NAMESPACE);

  if (transport === "live" || transport === "unavailable") {
    return null;
  }

  return (
    <p
      className="absolute inset-e-0 inset-s-0 top-full z-40 bg-working/10 px-3 py-1 text-center text-working text-xs"
      role="status"
    >
      {transport === "reconnecting"
        ? t("transport.reconnectingBand")
        : t("transport.staleBand")}
    </p>
  );
}

function LiveRegion({
  announcement,
  transport,
}: {
  announcement: OperationStatusRealtimeMessage | undefined;
  transport: RealtimeTransport;
}) {
  const t = useTranslations(OPERATIONS_NAMESPACE);
  let stateLabel = "";
  if (announcement) {
    const state = announcementStateOf(announcement);
    stateLabel =
      state === "retrying"
        ? t("state.retrying", { n: announcement.attemptCount ?? 1 })
        : t(`state.${state}`);
  }

  return (
    <p aria-live="polite" className="sr-only">
      {announcement
        ? t.rich("announcements.operation", {
            id: (value) => <Bdi>{value}</Bdi>,
            operationId: announcement.operationId,
            state: stateLabel,
          })
        : t(`announcements.${transport}`)}
    </p>
  );
}

function announcementStateOf(
  message: OperationStatusRealtimeMessage,
): PanelState {
  if (message.lifecycle === "settling") {
    return "running";
  }
  if (
    message.latestAttemptOutcome === "failed_retryable" &&
    (message.lifecycle === "queued" || message.lifecycle === "running")
  ) {
    return "retrying";
  }
  return message.lifecycle;
}
