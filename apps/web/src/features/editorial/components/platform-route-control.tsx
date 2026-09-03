"use client";

import type { Platform } from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Hint } from "@rz-chain-reporter/ui/components/hint";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { CheckIcon } from "lucide-react";

import { PlatformIcon } from "@/components/common/platform-icon";

import { ROUTE_STATUS_CLASS_NAME } from "./lane-layout";

export function PlatformRouteButton({
  accessibleLabel,
  buttonId,
  hint,
  onClick,
  pending,
  platform,
}: {
  accessibleLabel: string;
  buttonId: string;
  hint: string;
  onClick: () => void;
  pending: boolean;
  platform: Platform;
}) {
  return (
    <Hint label={hint}>
      <Button
        aria-busy={pending || undefined}
        aria-disabled={pending}
        aria-label={accessibleLabel}
        className="aria-disabled:pointer-events-none aria-disabled:opacity-50 max-compact:size-11"
        id={buttonId}
        onClick={pending ? undefined : onClick}
        size="icon-xs"
        type="button"
        variant="outline"
      >
        {pending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <PlatformIcon
            aria-hidden="true"
            data-icon="inline-start"
            platform={platform}
          />
        )}
      </Button>
    </Hint>
  );
}

export function PlatformRouteStatus({
  accessibleLabel,
  platform,
}: {
  accessibleLabel: string;
  platform: Platform;
}) {
  return (
    <Hint label={accessibleLabel}>
      <span className={ROUTE_STATUS_CLASS_NAME}>
        <PlatformIcon
          aria-hidden="true"
          className="size-3"
          platform={platform}
        />
        <CheckIcon
          aria-hidden="true"
          className="absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full bg-card p-px text-primary"
        />
        <span className="sr-only">{accessibleLabel}</span>
      </span>
    </Hint>
  );
}
