"use client";

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const separatorVariants = cva(
  "shrink-0 data-horizontal:w-full data-vertical:self-stretch",
  {
    variants: {
      variant: {
        default: "bg-border data-horizontal:h-px data-vertical:w-px",
        dashed:
          "border-border border-dashed data-horizontal:h-0 data-vertical:w-0 data-vertical:border-s data-horizontal:border-t",
        perforated:
          "bg-center [background-image:radial-gradient(circle_at_5px_5px,var(--color-background)_2.6px,var(--color-border)_2.6px_3.4px,transparent_3.5px)] data-horizontal:h-2.5 data-vertical:w-2.5 data-horizontal:bg-repeat-x data-vertical:bg-repeat-y data-horizontal:[background-size:16px_10px] data-vertical:[background-size:10px_16px]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Separator({
  className,
  orientation = "horizontal",
  variant = "default",
  ...props
}: SeparatorPrimitive.Props & VariantProps<typeof separatorVariants>) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      data-variant={variant}
      orientation={orientation}
      className={cn(separatorVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Separator, separatorVariants };
