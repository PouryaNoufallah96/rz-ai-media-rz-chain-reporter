import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-xl border px-3 py-2 text-start text-xs has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg:not([class*='size-'])]:size-4 *:[svg]:row-span-2",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90",
        working:
          "border-working/50 bg-working/10 text-foreground *:data-[slot=alert-description]:text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      className={cn(alertVariants({ variant }), className)}
      data-slot="alert"
      role="alert"
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "font-medium text-sm group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className,
      )}
      data-slot="alert-title"
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "text-muted-foreground text-xs/relaxed [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-2",
        className,
      )}
      data-slot="alert-description"
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle };
