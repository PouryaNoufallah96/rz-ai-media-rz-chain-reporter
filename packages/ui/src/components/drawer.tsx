"use client";

import {
  type TextDirection,
  useDirection,
} from "@base-ui/react/direction-provider";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  DialogFooter,
  DialogHeader,
} from "@rz-chain-reporter/ui/components/dialog";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { XIcon } from "lucide-react";
import * as React from "react";

type DrawerSide = "block-end" | "block-start" | "inline-end" | "inline-start";
type SwipeDirection = "down" | "left" | "right" | "up";

const DrawerContext = React.createContext<{
  modal: DrawerPrimitive.Root.Props["modal"];
  side: DrawerSide;
  swipeDirection: SwipeDirection;
}>({ modal: true, side: "block-end", swipeDirection: "down" });

const VIEWPORT_ALIGNMENT: Record<DrawerSide, string> = {
  "block-end": "items-end",
  "block-start": "items-start",
  "inline-end": "items-stretch justify-end",
  "inline-start": "items-stretch justify-start",
};

const POPUP_GEOMETRY: Record<DrawerSide, string> = {
  "block-end":
    "max-h-[85dvh] w-full flex-col border-t after:inset-x-0 after:top-full after:h-(--drawer-bleed)",
  "block-start":
    "max-h-[85dvh] w-full flex-col border-b after:inset-x-0 after:bottom-full after:h-(--drawer-bleed)",
  "inline-end":
    "h-full w-[min(420px,95vw)] flex-row border-s after:inset-y-0 after:start-full after:w-(--drawer-bleed)",
  "inline-start":
    "h-full w-[min(420px,95vw)] flex-row border-e after:inset-y-0 after:end-full after:w-(--drawer-bleed)",
};

// Base UI's swipe axis is physical (`SwipeDirection` in
// utils/useSwipeDismiss.d.ts) and does not consult the direction provider, so
// the inline sides are resolved here rather than by a direction-scoped override.
const POPUP_TRANSFORM: Record<SwipeDirection, string> = {
  down: "[--drawer-closed-transform:translate3d(0,calc(100%_+_2px),0)] [--drawer-open-transform:translate3d(0,var(--drawer-swipe-movement-y,0px),0)]",
  left: "[--drawer-closed-transform:translate3d(calc(-100%_-_2px),0,0)] [--drawer-open-transform:translate3d(var(--drawer-swipe-movement-x,0px),0,0)]",
  right:
    "[--drawer-closed-transform:translate3d(calc(100%_+_2px),0,0)] [--drawer-open-transform:translate3d(var(--drawer-swipe-movement-x,0px),0,0)]",
  up: "[--drawer-closed-transform:translate3d(0,calc(-100%_-_2px),0)] [--drawer-open-transform:translate3d(0,var(--drawer-swipe-movement-y,0px),0)]",
};

const HANDLE_GEOMETRY: Record<DrawerSide, string> = {
  "block-end": "h-3 w-full after:h-1 after:w-12",
  "block-start": "order-last h-3 w-full after:h-1 after:w-12",
  "inline-end": "h-full w-3 after:h-12 after:w-1",
  "inline-start": "order-last h-full w-3 after:h-12 after:w-1",
};

function resolveSwipeDirection(
  side: DrawerSide,
  direction: TextDirection,
): SwipeDirection {
  switch (side) {
    case "block-start":
      return "up";
    case "block-end":
      return "down";
    case "inline-start":
      return direction === "rtl" ? "right" : "left";
    default:
      return direction === "rtl" ? "left" : "right";
  }
}

function Drawer({
  direction,
  modal = true,
  side = "block-end",
  ...props
}: Omit<DrawerPrimitive.Root.Props, "swipeDirection"> & {
  direction?: TextDirection;
  side?: DrawerSide;
}) {
  const providerDirection = useDirection();
  const swipeDirection = resolveSwipeDirection(
    side,
    direction ?? providerDirection,
  );
  const context = React.useMemo(
    () => ({ modal, side, swipeDirection }),
    [modal, side, swipeDirection],
  );

  return (
    <DrawerContext value={context}>
      <DrawerPrimitive.Root
        data-slot="drawer"
        modal={modal}
        swipeDirection={swipeDirection}
        {...props}
      />
    </DrawerContext>
  );
}

function DrawerTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({ ...props }: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/45 opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-220 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*220ms)] data-swiping:duration-0 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

function DrawerViewport({
  className,
  ...props
}: DrawerPrimitive.Viewport.Props) {
  const { side } = React.use(DrawerContext);

  return (
    <DrawerPrimitive.Viewport
      data-slot="drawer-viewport"
      className={cn(
        "pointer-events-none fixed inset-0 z-50 flex overflow-hidden",
        VIEWPORT_ALIGNMENT[side],
        className,
      )}
      {...props}
    />
  );
}

function DrawerHandle({ className, ...props }: React.ComponentProps<"div">) {
  const { side } = React.use(DrawerContext);

  return (
    <div
      aria-hidden="true"
      data-slot="drawer-handle"
      className={cn(
        "flex shrink-0 cursor-grab items-center justify-center after:block after:shrink-0 after:bg-muted-foreground/60 after:content-[''] active:cursor-grabbing",
        HANDLE_GEOMETRY[side],
        className,
      )}
      {...props}
    />
  );
}

function DrawerPopup({
  children,
  className,
  closeLabel,
  showHandle = true,
  ...props
}: DrawerPrimitive.Popup.Props & {
  closeLabel?: string;
  showHandle?: boolean;
}) {
  const { side, swipeDirection } = React.use(DrawerContext);

  return (
    <DrawerPrimitive.Popup
      data-slot="drawer-popup"
      className={cn(
        "data-ending-style:transform-(--drawer-closed-transform) data-starting-style:transform-(--drawer-closed-transform) group/drawer-popup transform-(--drawer-open-transform) pointer-events-auto relative flex select-none bg-popover bg-clip-padding text-popover-foreground text-xs/relaxed shadow-lg outline-none transition-transform duration-220 ease-out [--drawer-bleed:3rem] after:pointer-events-none after:absolute after:bg-popover data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*220ms)] data-swiping:duration-0 motion-reduce:transition-none",
        POPUP_GEOMETRY[side],
        POPUP_TRANSFORM[swipeDirection],
        className,
      )}
      {...props}
    >
      {showHandle ? <DrawerHandle /> : null}
      <DrawerPrimitive.Content
        data-slot="drawer-body"
        className="flex min-h-0 flex-1 select-text flex-col gap-4 overflow-y-auto overscroll-contain p-4 group-data-swiping/drawer-popup:select-none"
      >
        {children}
      </DrawerPrimitive.Content>
      {closeLabel ? (
        <DrawerPrimitive.Close
          data-slot="drawer-close"
          render={
            <Button
              className="absolute inset-e-4 top-4"
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <XIcon />
          <span className="sr-only">{closeLabel}</span>
        </DrawerPrimitive.Close>
      ) : null}
    </DrawerPrimitive.Popup>
  );
}

function DrawerContent(props: React.ComponentProps<typeof DrawerPopup>) {
  const { modal } = React.use(DrawerContext);

  return (
    <DrawerPortal>
      {modal === true ? <DrawerOverlay /> : null}
      <DrawerViewport>
        <DrawerPopup data-slot="drawer-content" {...props} />
      </DrawerViewport>
    </DrawerPortal>
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("font-medium text-sm", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn(
        "text-muted-foreground text-xs/relaxed *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  DialogFooter as DrawerFooter,
  DialogHeader as DrawerHeader,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerOverlay,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
  DrawerViewport,
};
