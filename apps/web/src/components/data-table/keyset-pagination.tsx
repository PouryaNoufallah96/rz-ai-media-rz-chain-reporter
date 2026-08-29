"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";

interface KeysetPaginationProps {
  ariaLabel: string;
  backToLatestLabel: string;
  newerLabel: string;
  olderLabel: string;
  offLatest: boolean;
  newerCursor: string | null;
  olderCursor: string | null;
  onCursor: (cursor: string | null) => void;
}

export function KeysetPagination({
  ariaLabel,
  backToLatestLabel,
  newerLabel,
  olderLabel,
  offLatest,
  newerCursor,
  olderCursor,
  onCursor,
}: KeysetPaginationProps) {
  if (!offLatest && olderCursor === null) return null;

  return (
    <nav
      aria-label={ariaLabel}
      className="mt-4 flex flex-wrap items-center justify-end gap-2 [&_button]:max-sm:min-h-11"
    >
      {offLatest ? (
        <>
          <Button onClick={() => onCursor(null)} size="sm" variant="ghost">
            {backToLatestLabel}
          </Button>
          <Button
            onClick={() => onCursor(newerCursor)}
            size="sm"
            variant="outline"
          >
            {newerLabel}
          </Button>
        </>
      ) : null}
      {olderCursor ? (
        <Button
          onClick={() => onCursor(olderCursor)}
          size="sm"
          variant="outline"
        >
          {olderLabel}
        </Button>
      ) : null}
    </nav>
  );
}
