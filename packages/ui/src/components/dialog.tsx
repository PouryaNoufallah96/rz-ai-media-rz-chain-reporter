"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { XIcon } from "lucide-react";
import type * as React from "react";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/45 opacity-100 transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-150 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

function DialogViewport({
  className,
  ...props
}: DialogPrimitive.Viewport.Props) {
  return (
    <DialogPrimitive.Viewport
      data-slot="dialog-viewport"
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center overflow-hidden p-4",
        className,
      )}
      {...props}
    />
  );
}

function DialogPopup({
  children,
  className,
  closeLabel,
  ...props
}: DialogPrimitive.Popup.Props & { closeLabel?: string }) {
  return (
    <DialogPrimitive.Popup
      data-slot="dialog-popup"
      className={cn(
        "relative grid max-h-full gap-5 overflow-y-auto overscroll-contain rounded-xl bg-popover p-(--dialog-padding) text-popover-foreground text-xs/relaxed shadow-lg outline-none ring-1 ring-foreground/10 ring-inset transition-[opacity,scale,translate] duration-200 ease-out [--dialog-close-block-start:--spacing(2)] [--dialog-close-inline-end:--spacing(2)] [--dialog-closed-scale:0.97] [--dialog-closed-translate-y:0px] [--dialog-padding:--spacing(5)] data-ending-style:translate-y-(--dialog-closed-translate-y) data-starting-style:translate-y-(--dialog-closed-translate-y) data-ending-style:scale-(--dialog-closed-scale) data-starting-style:scale-(--dialog-closed-scale) data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-150 motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      {children}
      {closeLabel ? (
        <DialogPrimitive.Close
          data-slot="dialog-close"
          render={
            <Button
              className="absolute inset-e-(--dialog-close-inline-end) top-(--dialog-close-block-start)"
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <XIcon />
          <span className="sr-only">{closeLabel}</span>
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Popup>
  );
}

function DialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogPopup>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogViewport>
        <DialogPopup
          data-slot="dialog-content"
          className={cn("w-full max-w-sm", className)}
          {...props}
        />
      </DialogViewport>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1 text-start", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 pt-3 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-semibold text-base", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-muted-foreground text-xs/relaxed *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
};
