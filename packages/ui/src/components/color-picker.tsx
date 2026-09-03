"use client";

import { Input } from "@rz-chain-reporter/ui/components/input";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { type KeyboardEvent, type PointerEvent, useState } from "react";

type Rgb = { r: number; g: number; b: number };
type Hsv = { h: number; s: number; v: number };

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RANGE_THUMB =
  "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:shadow-sm [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-sm";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function parseHex(value: string): Rgb | null {
  const match = HEX_PATTERN.exec(value.trim());
  if (!match) return null;
  const raw = match[1] ?? "";
  const digits =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb) {
  return `#${[r, g, b]
    .map((channel) =>
      clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"),
    )
    .join("")}`;
}

function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const diff = max - min;
  let h = 0;
  if (diff !== 0) {
    if (max === rn) h = ((gn - bn) / diff) % 6;
    else if (max === gn) h = (bn - rn) / diff + 2;
    else h = (rn - gn) / diff + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : (diff / max) * 100, v: max * 100 };
}

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function ColorPicker({
  className,
  disabled = false,
  labels,
  onChange,
  swatches = [],
  value,
}: {
  className?: string;
  disabled?: boolean;
  labels: {
    hex: string;
    hue: string;
    plane: string;
    swatch: (color: string) => string;
  };
  onChange: (value: string) => void;
  swatches?: readonly string[];
  value: string;
}) {
  const rgb = parseHex(value);
  const parsed = rgb ? rgbToHsv(rgb) : null;
  const [fallbackHue, setFallbackHue] = useState(parsed?.h ?? 0);
  const [draft, setDraft] = useState<string | null>(null);
  const hsv: Hsv = {
    h: parsed && parsed.s > 0 && parsed.v > 0 ? parsed.h : fallbackHue,
    s: parsed?.s ?? 0,
    v: parsed?.v ?? 0,
  };
  const hex = toHex(rgb ?? hsvToRgb(hsv)).toUpperCase();

  const emit = (next: Hsv) => {
    setFallbackHue(next.h);
    onChange(toHex(hsvToRgb(next)));
  };

  const emitPlane = (s: number, v: number) =>
    emit({ h: hsv.h, s: clamp(s, 0, 100), v: clamp(v, 0, 100) });

  const updatePlane = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    emitPlane(
      ((event.clientX - rect.left) / rect.width) * 100,
      100 - ((event.clientY - rect.top) / rect.height) * 100,
    );
  };

  const stepPlane = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    emitPlane(hsv.s + move[0], hsv.v + move[1]);
  };

  return (
    <div
      className={cn("grid w-64 max-w-full gap-3", className)}
      data-slot="color-picker"
      dir="ltr"
    >
      <div
        className="relative h-40 overflow-hidden rounded-md border"
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
      >
        <div className="absolute inset-0 bg-linear-to-r from-white to-transparent" />
        <div className="absolute inset-0 bg-linear-to-t from-black to-transparent" />
        <div
          aria-disabled={disabled || undefined}
          aria-label={labels.plane}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(hsv.v)}
          aria-valuetext={hex}
          className="absolute inset-0 cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:pointer-events-none"
          onKeyDown={disabled ? undefined : stepPlane}
          onPointerDown={(event) => {
            if (disabled) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            updatePlane(event);
          }}
          onPointerMove={(event) => {
            if (disabled || (event.buttons & 1) !== 1) return;
            updatePlane(event);
          }}
          role="slider"
          tabIndex={disabled ? -1 : 0}
        >
          <div
            className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm"
            style={{
              left: `${hsv.s}%`,
              top: `${100 - hsv.v}%`,
              backgroundColor: hex,
            }}
          />
        </div>
      </div>
      <input
        aria-label={labels.hue}
        className={cn(
          "h-4 w-full cursor-pointer appearance-none rounded-full border disabled:cursor-not-allowed disabled:opacity-50",
          RANGE_THUMB,
        )}
        disabled={disabled}
        max={360}
        min={0}
        onChange={(event) =>
          emit({ ...hsv, h: Number(event.currentTarget.value) })
        }
        style={{
          background:
            "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
        }}
        type="range"
        value={hsv.h}
      />
      <Input
        aria-label={labels.hex}
        autoComplete="off"
        className="font-mono uppercase"
        disabled={disabled}
        maxLength={7}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setDraft(raw);
          const next = parseHex(raw);
          if (next) {
            setFallbackHue(rgbToHsv(next).h);
            onChange(toHex(next));
          }
        }}
        spellCheck={false}
        value={draft ?? hex}
      />
      {swatches.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {swatches.map((swatch) => (
            <button
              aria-label={labels.swatch(swatch)}
              aria-pressed={swatch.toUpperCase() === hex}
              className="size-6 rounded-md border outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-pressed:ring-2 aria-pressed:ring-ring"
              disabled={disabled}
              key={swatch}
              onClick={() => {
                const next = parseHex(swatch);
                if (next) {
                  setFallbackHue(rgbToHsv(next).h);
                  onChange(toHex(next));
                }
              }}
              style={{ backgroundColor: swatch }}
              type="button"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
