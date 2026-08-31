"use client";

import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "@rz-chain-reporter/ui/components/dialog";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import type * as React from "react";

const MOBILE_SAFE_AREA =
  "max-md:pt-[calc(var(--dialog-padding)+env(safe-area-inset-top))] max-md:pr-[calc(var(--dialog-padding)+env(safe-area-inset-right))] max-md:pb-[calc(var(--dialog-padding)+env(safe-area-inset-bottom))] max-md:pl-[calc(var(--dialog-padding)+env(safe-area-inset-left))] max-md:ltr:[--dialog-close-inline-end:calc(--spacing(2)+env(safe-area-inset-right))] max-md:rtl:[--dialog-close-inline-end:calc(--spacing(2)+env(safe-area-inset-left))]";

function ResponsiveModalContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogPopup>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogViewport className="max-md:items-end max-md:p-0 max-md:pt-[calc(--spacing(10)+env(safe-area-inset-top))]">
        <DialogPopup
          data-slot="responsive-modal-content"
          className={cn(
            "w-full max-w-md max-md:max-w-none max-md:rounded-b-none max-md:[--dialog-closed-scale:1] max-md:[--dialog-closed-translate-y:1rem]",
            className,
            MOBILE_SAFE_AREA,
          )}
          {...props}
        />
      </DialogViewport>
    </DialogPortal>
  );
}

export {
  Dialog as ResponsiveModal,
  DialogClose as ResponsiveModalClose,
  DialogDescription as ResponsiveModalDescription,
  DialogFooter as ResponsiveModalFooter,
  DialogHeader as ResponsiveModalHeader,
  DialogTitle as ResponsiveModalTitle,
  DialogTrigger as ResponsiveModalTrigger,
  ResponsiveModalContent,
};
