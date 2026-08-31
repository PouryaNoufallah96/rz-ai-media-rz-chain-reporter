"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { PanelLeftIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

function Sidebar({ className, ...props }: CollapsiblePrimitive.Root.Props) {
  return (
    <CollapsiblePrimitive.Root
      className={cn(
        "group/sidebar relative grid min-w-0 grid-cols-[0rem_minmax(0,1fr)] items-start gap-y-3 workspace:overflow-x-clip transition-[grid-template-columns,column-gap] duration-200 ease-out workspace:data-open:grid-cols-[20rem_minmax(0,1fr)] workspace:data-open:gap-x-5 motion-reduce:transition-none",
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
  icon = <PanelLeftIcon className="rtl:rotate-180" data-icon="inline-end" />,
  ...props
}: CollapsiblePrimitive.Trigger.Props & { icon?: ReactNode }) {
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
      {icon}
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
        "workspace:sticky workspace:top-4 col-start-1 row-start-2 flex workspace:max-h-[calc(100dvh-2rem)] w-80 min-w-0 flex-col gap-4 workspace:overflow-y-auto rounded-xl border border-sidebar-border bg-sidebar p-3 text-sidebar-foreground transition-[translate,opacity] duration-200 ease-out data-closed:pointer-events-none data-ending-style:-translate-x-full data-starting-style:-translate-x-full data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none max-workspace:hidden rtl:data-ending-style:translate-x-full rtl:data-starting-style:translate-x-full",
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
