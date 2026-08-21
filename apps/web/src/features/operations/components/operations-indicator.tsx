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
import { StateMark } from "@/components/common/state-mark";
import { authClient } from "@/features/auth/lib/auth-client";
import { CHIP_COUNT_CAP, OPERATIONS_NAMESPACE } from "../constants";
import { useOperationsList } from "../hooks/use-operations-list";
import {
  type RealtimeTransport,
  useOperationsRealtime,
} from "../hooks/use-operations-realtime";
import {
  chipsOf,
  edgeToneOf,
  type PanelState,
  panelStateOf,
} from "../lib/panel-state";
import { ColorBar } from "./color-bar";
import { OperationsPanel, OperationsPanelSkeleton } from "./operations-panel";

export function OperationsIndicator() {
  const t = useTranslations(OPERATIONS_NAMESPACE);
  const { data: session } = authClient.useSession();
  const operations = useOperationsList(Boolean(session));
  const realtime = useOperationsRealtime({
    enabled: Boolean(session),
    refetch: operations.refetch,
  });
  const states = (operations.data ?? []).map(panelStateOf);
  const chips = chipsOf(states);
  const barTone =
    realtime.transport === "live" ? (edgeToneOf(states) ?? "idle") : "offline";

  if (!session) {
    return null;
  }

  return (
    <>
      <Sheet>
        <SheetTrigger
          render={<Button className="max-w-full" size="sm" variant="ghost" />}
        >
          <span className="sr-only">{t("indicator.label")}</span>
          <span
            aria-hidden="true"
            className="flex items-center gap-1 xl:hidden"
          >
            <ColorBar tone={barTone} />
            <span className="font-mono text-xs tabular-nums">
              {states.length > CHIP_COUNT_CAP
                ? t("indicator.countCapped")
                : t("indicator.count", { count: states.length })}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="hidden items-center gap-2 xl:flex"
          >
            <ColorBar tone={barTone} />
            {chips.map((chip) => (
              <span className="flex items-center gap-1" key={chip.state}>
                <StateMark state={chip.state} />
                <span className="font-mono text-xs tabular-nums">
                  {chip.count > CHIP_COUNT_CAP
                    ? t("indicator.countCapped")
                    : t("indicator.count", { count: chip.count })}
                </span>
              </span>
            ))}
          </span>
        </SheetTrigger>
        <SheetContent className="min-w-0" closeLabel={t("panel.close")}>
          <SheetHeader className="pe-8">
            <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <SheetTitle>{t("panel.title")}</SheetTitle>
              <TransportReadout
                isFetching={operations.isFetching}
                onRefresh={() => {
                  void operations.refetch();
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
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="wrap-break-word min-w-0 font-mono text-muted-foreground text-xs tabular-nums">
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
