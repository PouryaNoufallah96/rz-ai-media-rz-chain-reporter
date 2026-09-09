"use client";

import { BackgroundGradient } from "@rz-chain-reporter/ui/components/background-gradient";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@rz-chain-reporter/ui/components/dialog";
import { AppWindowIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useRef,
} from "react";

import { Link } from "@/i18n/navigation";

import { ASSISTANT_NAMESPACE } from "../constants";

const MIN_SIZE = { height: 512, width: 384 };
const SIZE_STEP = 64;
const LARGE_SIZE_STEP = SIZE_STEP * 2;

type PanelSize = { height: number; width: number };
type ResizeEdge = "block-start" | "inline-start" | "corner";

function AssistantFloatingPanel({
  composer,
  launcher,
  onFloatingHost,
  onOpenChange,
  onResize,
  open,
  panelId,
  size,
}: {
  composer: RefObject<HTMLTextAreaElement | null>;
  launcher: RefObject<HTMLButtonElement | null>;
  onFloatingHost: (node: HTMLDivElement | null) => void;
  onOpenChange: (open: boolean) => void;
  onResize: (size: PanelSize) => void;
  open: boolean;
  panelId: string;
  size: PanelSize | null;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const style = size
    ? ({ height: size.height, width: size.width } satisfies CSSProperties)
    : undefined;

  return (
    <Dialog
      disablePointerDismissal
      modal={false}
      onOpenChange={onOpenChange}
      open={open}
    >
      <DialogPortal>
        <DialogPopup
          className="fixed inset-e-4 bottom-24 z-70 flex h-[min(32rem,70svh)] max-h-[calc(100dvh-6rem)] w-[min(24rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col overflow-hidden bg-transparent p-0 shadow-none ring-0 max-sm:**:data-[slot=button]:min-h-11 max-sm:**:data-[slot=dialog-close]:min-h-11 max-sm:**:data-[slot=button]:min-w-11 max-sm:**:data-[slot=dialog-close]:min-w-11 max-compact:inset-e-0 max-compact:inset-s-0 max-compact:bottom-0 max-compact:h-dvh! max-compact:max-h-dvh max-compact:w-auto! max-compact:max-w-none max-compact:rounded-none"
          data-assistant-surface
          finalFocus={launcher}
          id={panelId}
          initialFocus={composer}
          style={style}
        >
          <BackgroundGradient
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 max-compact:rounded-none max-compact:pb-[calc(--spacing(3)+env(safe-area-inset-bottom))]"
            containerClassName="flex min-h-0 flex-1 flex-col max-compact:rounded-none max-compact:p-0"
          >
            <DialogHeader className="flex-row items-center">
              <DialogTitle className="me-auto text-sm">
                {t("panel.title")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("panel.description")}
              </DialogDescription>
              <Button
                aria-label={t("panel.openPage")}
                className="max-compact:hidden"
                nativeButton={false}
                render={<Link href="/assistant" />}
                size="icon-xs"
                variant="ghost"
              >
                <AppWindowIcon />
              </Button>
              <DialogClose render={<Button size="icon-xs" variant="ghost" />}>
                <XIcon />
                <span className="sr-only">{t("panel.close")}</span>
              </DialogClose>
            </DialogHeader>

            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-assistant-floating-host
              ref={onFloatingHost}
            />
          </BackgroundGradient>

          <ResizeEdges
            label={t("panel.resize")}
            onResize={onResize}
            size={size}
          />
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

function ResizeEdges({
  label,
  size,
  onResize,
}: {
  label: string;
  size: PanelSize | null;
  onResize: (size: PanelSize) => void;
}) {
  const start = useRef<{
    direction: 1 | -1;
    edge: ResizeEdge;
    height: number;
    width: number;
    x: number;
    y: number;
  } | null>(null);

  const begin = (
    edge: ResizeEdge,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const panel = event.currentTarget.closest('[data-slot="dialog-popup"]');
    const rect =
      panel instanceof HTMLElement
        ? panel.getBoundingClientRect()
        : { height: MIN_SIZE.height, width: MIN_SIZE.width };
    start.current = {
      direction:
        getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1,
      edge,
      height: size?.height ?? rect.height,
      width: size?.width ?? rect.width,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      !start.current ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      return;
    }
    const nextWidth =
      start.current.edge === "block-start"
        ? start.current.width
        : start.current.width +
          (start.current.x - event.clientX) * start.current.direction;
    const nextHeight =
      start.current.edge === "inline-start"
        ? start.current.height
        : start.current.height + (start.current.y - event.clientY);
    onResize(clampSize(nextWidth, nextHeight));
  };

  const end = (event: ReactPointerEvent<HTMLButtonElement>) => {
    start.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      onResize(MIN_SIZE);
      return;
    }
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const step = event.shiftKey ? LARGE_SIZE_STEP : SIZE_STEP;
    const direction = getComputedStyle(event.currentTarget).direction;
    const inlineStart = direction === "rtl" ? "ArrowRight" : "ArrowLeft";
    const inlineEnd = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
    const horizontal =
      event.key === inlineStart ? step : event.key === inlineEnd ? -step : 0;
    const vertical =
      event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
    if (horizontal === 0 && vertical === 0) return;
    const current = size ?? MIN_SIZE;
    onResize(clampSize(current.width + horizontal, current.height + vertical));
  };

  return (
    <>
      <button
        aria-hidden="true"
        className="absolute inset-e-14 inset-s-0 top-0 z-10 h-1.5 cursor-ns-resize touch-none max-compact:hidden"
        onPointerCancel={end}
        onPointerDown={(event) => begin("block-start", event)}
        onPointerMove={move}
        onPointerUp={end}
        tabIndex={-1}
        type="button"
      />
      <button
        aria-hidden="true"
        className="absolute inset-s-0 top-3 bottom-0 z-10 w-1.5 cursor-ew-resize touch-none max-compact:hidden"
        onPointerCancel={end}
        onPointerDown={(event) => begin("inline-start", event)}
        onPointerMove={move}
        onPointerUp={end}
        tabIndex={-1}
        type="button"
      />
      <button
        aria-label={label}
        className="absolute inset-s-0 top-0 z-10 size-3 cursor-nesw-resize touch-none max-compact:hidden rtl:cursor-nwse-resize"
        onKeyDown={onKeyDown}
        onPointerCancel={end}
        onPointerDown={(event) => begin("corner", event)}
        onPointerMove={move}
        onPointerUp={end}
        type="button"
      />
    </>
  );
}

function clampSize(width: number, height: number): PanelSize {
  return {
    width: Math.max(
      MIN_SIZE.width,
      Math.min(width, globalThis.innerWidth - 32),
    ),
    height: Math.max(
      MIN_SIZE.height,
      Math.min(height, globalThis.innerHeight - 96),
    ),
  };
}

export type { PanelSize };
export { AssistantFloatingPanel };
