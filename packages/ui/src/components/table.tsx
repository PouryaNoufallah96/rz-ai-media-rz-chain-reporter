import { cn } from "@rz-chain-reporter/ui/lib/utils";
import type * as React from "react";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  const isAriaHidden =
    props["aria-hidden"] === true || props["aria-hidden"] === "true";

  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
      tabIndex={isAriaHidden ? undefined : 0}
    >
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom border-collapse text-[12.5px]",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-muted/50 [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  );
}

function TableBody({ ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors duration-150 last:border-b-0 hover:bg-muted/50 data-[state=selected]:bg-accent",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "ticket-label whitespace-nowrap px-3 py-3 text-start align-middle text-muted-foreground [&>button]:inline-flex [&>button]:items-center [&>button]:gap-1.5 [&>button]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-3 py-3 text-start align-middle", className)}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-3 text-start text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
};
