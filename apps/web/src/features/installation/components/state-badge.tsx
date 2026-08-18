import type { ReactNode } from "react";

const TONE = {
  neutral: "border-border text-muted-foreground",
  warning: "border-working text-working",
} as const;

export function StateBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center border px-1.5 py-0.5 text-xs ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
