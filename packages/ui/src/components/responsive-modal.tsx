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

function ResponsiveModalContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogPopup>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogViewport className="max-md:items-end max-md:p-0 max-md:pt-10">
        <DialogPopup
          data-slot="responsive-modal-content"
          className={cn(
            "w-full max-w-md max-md:max-w-none max-md:rounded-b-none max-md:[--dialog-closed-scale:1] max-md:[--dialog-closed-translate-y:1rem]",
            className,
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
