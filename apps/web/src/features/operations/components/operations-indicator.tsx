"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@rz-chain-reporter/ui/components/sheet";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { orpc } from "@/lib/orpc";

import { OPERATIONS_NAMESPACE } from "../constants";
import {
  CHIP_COUNT_CAP,
  POLL_INTERVAL_MS,
  RECONNECT_BANNER_MS,
} from "./constants";
import { OperationsPanel, OperationsPanelSkeleton } from "./operations-panel";
import { type Chip, chipsOf, edgeToneOf, panelStateOf } from "./panel-state";
import { ColorBar, StateMark } from "./state-mark";

type Transport = "online" | "offline" | "restored";

export function OperationsIndicator() {
  const t = useTranslations(OPERATIONS_NAMESPACE);
  const { data: session } = authClient.useSession();

  const operations = useQuery(
    orpc.operations.list.queryOptions({
      enabled: Boolean(session),
      refetchInterval: POLL_INTERVAL_MS,
      staleTime: 0,
    }),
  );

  const transport = useTransport(
    operations.fetchStatus === "paused" || operations.isError,
  );
  const states = (operations.data ?? []).map(panelStateOf);
  const chips = chipsOf(states);

  const barTone =
    transport === "offline" ? "offline" : (edgeToneOf(states) ?? "idle");

  if (!session) {
    return null;
  }

  return (
    <>
      <Sheet>
        <SheetTrigger render={<Button size="sm" variant="ghost" />}>
          <span className="sr-only">{t("indicator.label")}</span>
          <span aria-hidden="true" className="flex items-center gap-2">
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
        <SheetContent closeLabel={t("panel.close")}>
          <SheetHeader>
            <SheetTitle>{t("panel.title")}</SheetTitle>
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
        chips={chips}
        isError={operations.isError}
        isFetching={operations.isFetching}
      />
      {transport === "online" ? null : (
        <p
          className="absolute inset-e-0 inset-s-0 top-full z-40 bg-muted px-3 py-1 text-center text-muted-foreground text-xs"
          role="status"
        >
          {transport === "offline"
            ? t("transport.offline")
            : t("transport.restored")}
        </p>
      )}
    </>
  );
}

function LiveRegion({
  chips,
  isError,
  isFetching,
}: {
  chips: Chip[];
  isError: boolean;
  isFetching: boolean;
}) {
  const t = useTranslations(OPERATIONS_NAMESPACE);

  return (
    <p aria-live="polite" className="sr-only">
      {isFetching
        ? t("transport.updating")
        : isError
          ? t("errors.internalServerError")
          : chips.map((chip) => (
              <span key={chip.state}>
                {t(`state.${chip.state}`)}{" "}
                {t("indicator.count", { count: chip.count })}
              </span>
            ))}
    </p>
  );
}

function useTransport(isOffline: boolean): Transport {
  const [wasOffline, setWasOffline] = useState(false);

  if (isOffline && !wasOffline) {
    setWasOffline(true);
  }

  useEffect(() => {
    if (isOffline || !wasOffline) {
      return;
    }

    const timer = setTimeout(() => setWasOffline(false), RECONNECT_BANNER_MS);
    return () => clearTimeout(timer);
  }, [isOffline, wasOffline]);

  if (isOffline) {
    return "offline";
  }

  return wasOffline ? "restored" : "online";
}
