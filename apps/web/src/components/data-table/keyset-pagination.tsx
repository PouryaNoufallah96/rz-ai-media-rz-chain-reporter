"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";

interface KeysetPaginationProps {
  backToLatestLabel: string;
  newerLabel: string;
  olderLabel: string;
  offLatest: boolean;
  onBackToLatest: () => void;
  onNewer: () => void;
  onOlder: (() => void) | null;
}

export function KeysetPagination({
  backToLatestLabel,
  newerLabel,
  olderLabel,
  offLatest,
  onBackToLatest,
  onNewer,
  onOlder,
}: KeysetPaginationProps) {
  if (!offLatest && onOlder === null) return null;

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-end gap-2 [&_button]:max-sm:min-h-11">
      {offLatest ? (
        <>
          <Button onClick={onBackToLatest} size="sm" variant="ghost">
            {backToLatestLabel}
          </Button>
          <Button onClick={onNewer} size="sm" variant="outline">
            {newerLabel}
          </Button>
        </>
      ) : null}
      {onOlder ? (
        <Button onClick={onOlder} size="sm" variant="outline">
          {olderLabel}
        </Button>
      ) : null}
    </nav>
  );
}
