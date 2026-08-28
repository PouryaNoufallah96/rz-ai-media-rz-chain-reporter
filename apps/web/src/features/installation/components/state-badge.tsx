import { Badge } from "@rz-chain-reporter/ui/components/badge";
import type { ReactNode } from "react";

const TONE = {
  neutral: "text-muted-foreground",
  warning: "border-working/30 bg-working/10 text-working",
} as const;

export function StateBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <Badge
      variant="outline"
      className={`h-auto max-w-full whitespace-normal py-0.5 ${TONE[tone]}`}
    >
      {children}
    </Badge>
  );
}
