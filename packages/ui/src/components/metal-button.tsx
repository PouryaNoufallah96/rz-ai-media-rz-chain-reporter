"use client";

import type { Button as ButtonPrimitive } from "@base-ui/react/button";
import {
  Button,
  type buttonVariants,
} from "@rz-chain-reporter/ui/components/button";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import type { VariantProps } from "class-variance-authority";
import { MetalFx, type MetalFxPreset } from "metal-fx";
import { useSyncExternalStore } from "react";

function subscribeTheme(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getIsLightSnapshot() {
  return document.documentElement.classList.contains("light");
}

function getIsLightServerSnapshot() {
  return false;
}

function subscribeReducedMotion(onStoreChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getReducedMotionServerSnapshot() {
  return false;
}

function MetalButton({
  className,
  preset = "chromatic",
  strength = 0.65,
  disableGlow = false,
  disabled = false,
  paused = false,
  size = "default",
  variant = "default",
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    preset?: MetalFxPreset;
    strength?: number;
    disableGlow?: boolean;
    paused?: boolean;
  }) {
  const isLight = useSyncExternalStore(
    subscribeTheme,
    getIsLightSnapshot,
    getIsLightServerSnapshot,
  );
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  return (
    <MetalFx
      className="active:scale-99 has-focus-visible:ring-2 has-focus-visible:ring-ring/50 has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background data-disabled:active:scale-100 motion-reduce:transition-none! motion-reduce:active:scale-100"
      data-disabled={disabled || undefined}
      disableGlow={disableGlow}
      paused={paused || reducedMotion}
      preset={preset}
      ringCssPx={2}
      strength={strength}
      theme={isLight ? "light" : "dark"}
      variant="button"
    >
      <Button
        className={cn(
          "font-semibold",
          isLight ? "text-foreground" : "text-primary-foreground",
          className,
        )}
        disabled={disabled}
        size={size}
        variant={variant}
        {...props}
      />
    </MetalFx>
  );
}

export { MetalButton };
