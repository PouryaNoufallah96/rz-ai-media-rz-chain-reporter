"use client";

import { SegmentError } from "@/components/common/segment-error";

export default function LocaleError({ reset }: { reset: () => void }) {
  return (
    <main
      className="mx-auto flex w-full max-w-lg flex-col items-start justify-center gap-4 px-6 py-16"
      id="main-content"
    >
      <SegmentError reset={reset} />
    </main>
  );
}
