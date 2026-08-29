"use client";

import { DIRECTION, isLocale } from "@rz-chain-reporter/i18n";
import { useLocale } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { LightRays, type Rgb } from "./light-rays";

let colorContext: CanvasRenderingContext2D | null = null;

function cssColorToRgb(cssColor: string): Rgb {
  if (!colorContext) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    colorContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!colorContext) return [1, 1, 1];

  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillStyle = "#000";
  colorContext.fillStyle = cssColor;
  colorContext.fillRect(0, 0, 1, 1);
  const data = colorContext.getImageData(0, 0, 1, 1).data;
  return [(data[0] ?? 0) / 255, (data[1] ?? 0) / 255, (data[2] ?? 0) / 255];
}

function resolvePrimaryColor(host: HTMLElement) {
  const probe = document.createElement("span");
  probe.style.color = "var(--primary)";
  host.appendChild(probe);
  const color = cssColorToRgb(getComputedStyle(probe).color);
  probe.remove();
  return color;
}

function SignInSideRays() {
  const hostRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const locale = useLocale();
  const [color, setColor] = useState<Rgb | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !resolvedTheme) return;
    setColor(resolvePrimaryColor(host));
  }, [resolvedTheme]);

  const origin =
    isLocale(locale) && DIRECTION[locale] === "rtl" ? "top-left" : "top-right";

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-80 sm:opacity-60 dark:opacity-90 sm:dark:opacity-70"
      ref={hostRef}
    >
      {color ? <LightRays color={color} origin={origin} /> : null}
    </div>
  );
}

export { SignInSideRays };
