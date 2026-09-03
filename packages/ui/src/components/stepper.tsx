"use client";

import { cn } from "@rz-chain-reporter/ui/lib/utils";
import type { ComponentProps, KeyboardEvent } from "react";

function handleStepperKeyDown(event: KeyboardEvent<HTMLOListElement>) {
  if (
    !["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.key)
  ) {
    return;
  }
  const triggers = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "[data-stepper-trigger]:not(:disabled)",
    ),
  );
  const activeIndex = triggers.indexOf(
    document.activeElement as HTMLButtonElement,
  );
  if (activeIndex < 0 || triggers.length < 2) return;
  const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
  const backwards =
    event.key === "ArrowUp" ||
    (event.key === "ArrowLeft" && !rtl) ||
    (event.key === "ArrowRight" && rtl);
  const next =
    (activeIndex + (backwards ? -1 : 1) + triggers.length) % triggers.length;
  event.preventDefault();
  triggers[next]?.focus();
}

function Stepper({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      className={cn("grid gap-1", className)}
      data-slot="stepper"
      onKeyDown={handleStepperKeyDown}
      {...props}
    />
  );
}

function StepperItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      className={cn("group/step relative min-w-0", className)}
      data-slot="stepper-item"
      {...props}
    />
  );
}

function StepperTrigger({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground group-data-[current=true]/step:bg-accent group-data-[current=true]/step:font-medium group-data-[current=true]/step:text-accent-foreground",
        className,
      )}
      data-stepper-trigger=""
      data-slot="stepper-trigger"
      type="button"
      {...props}
    />
  );
}

function StepperIndicator({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-[11px] tabular-nums group-data-[complete=true]/step:border-proof group-data-[current=true]/step:border-primary group-data-[current=true]/step:bg-primary group-data-[complete=true]/step:text-proof-text group-data-[current=true]/step:text-primary-foreground",
        className,
      )}
      data-slot="stepper-indicator"
      {...props}
    />
  );
}

function StepperSeparator({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute start-[calc((--spacing(5.5))-1px)] top-1/2 -bottom-[calc(50%+(--spacing(1)))] w-0.5 bg-border transition-colors group-data-[complete=true]/step:bg-proof",
        className,
      )}
      data-slot="stepper-separator"
      {...props}
    />
  );
}

function StepperTitle({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("min-w-0 truncate", className)}
      data-slot="stepper-title"
      {...props}
    />
  );
}

export {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
};
