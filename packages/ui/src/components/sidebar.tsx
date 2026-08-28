"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { PanelLeftIcon } from "lucide-react";
import type { ComponentProps } from "react";

function Sidebar({ className, ...props }: CollapsiblePrimitive.Root.Props) {
  return (
    <CollapsiblePrimitive.Root
      className={cn(
        "group/sidebar relative grid min-w-0 grid-cols-[0rem_minmax(0,1fr)] items-start gap-y-3 overflow-x-clip transition-[grid-template-columns,column-gap] duration-200 ease-out motion-reduce:transition-none min-[900px]:data-open:grid-cols-[20rem_minmax(0,1fr)] min-[900px]:data-open:gap-x-5",
        className,
      )}
      data-slot="sidebar"
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("col-span-2 flex items-center gap-2", className)}
      data-slot="sidebar-header"
      {...props}
    />
  );
}

function SidebarTrigger({
  children,
  className,
  ...props
}: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      className={cn(
        "group/sidebar-trigger min-h-9 gap-2 max-sm:min-h-11",
        className,
      )}
      data-slot="sidebar-trigger"
      render={<Button variant="outline" />}
      {...props}
    >
      {children}
      <PanelLeftIcon className="rtl:rotate-180" data-icon="inline-end" />
    </CollapsiblePrimitive.Trigger>
  );
}

function SidebarContent({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      className={cn(
        "col-start-1 row-start-2 flex w-80 min-w-0 flex-col gap-4 rounded-xl border border-sidebar-border bg-sidebar p-3 text-sidebar-foreground transition-[transform,opacity] duration-200 ease-out data-closed:pointer-events-none data-ending-style:-translate-x-full data-starting-style:-translate-x-full data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none max-[899px]:absolute max-[899px]:inset-s-0 max-[899px]:top-0 max-[899px]:z-30 max-[899px]:max-h-[calc(100dvh-10rem)] max-[899px]:max-w-[calc(100vw-2rem)] max-[899px]:overflow-y-auto max-[899px]:shadow-lg min-[900px]:sticky min-[900px]:top-4 min-[900px]:max-h-[calc(100dvh-2rem)] min-[900px]:overflow-y-auto rtl:data-ending-style:translate-x-full rtl:data-starting-style:translate-x-full",
        className,
      )}
      data-slot="sidebar-content"
      keepMounted
      render={<aside />}
      {...props}
    />
  );
}

export { Sidebar, SidebarContent, SidebarHeader, SidebarTrigger };
