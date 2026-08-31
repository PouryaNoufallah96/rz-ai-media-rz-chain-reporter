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
  label: ReactNode;
  side?: ComponentProps<typeof TooltipContent>["side"];
};

function Hint({
  align,
  children,
  delay = 0,
  label,
  side,
  ...props
}: HintProps) {
  return (
    <Tooltip>
      <TooltipTrigger delay={delay} render={children} {...props} />
      <TooltipContent align={align} side={side}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export { Hint };
