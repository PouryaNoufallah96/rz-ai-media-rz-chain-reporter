"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@rz-chain-reporter/ui/components/tooltip";
import type { ComponentProps, ReactElement, ReactNode } from "react";

type HintProps = Omit<
  ComponentProps<typeof TooltipTrigger>,
  "children" | "render"
> & {
  align?: ComponentProps<typeof TooltipContent>["align"];
  children: ReactElement;
  keys?: ReactNode;
  label: ReactNode;
  side?: ComponentProps<typeof TooltipContent>["side"];
};

function Hint({
  align,
  children,
  delay = 0,
  keys,
  label,
  side,
  ...props
}: HintProps) {
  return (
    <Tooltip>
      <TooltipTrigger delay={delay} render={children} {...props} />
      <TooltipContent align={align} side={side}>
        <span className="inline-flex items-center gap-2">
          <span>{label}</span>
          {keys}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export { Hint };
