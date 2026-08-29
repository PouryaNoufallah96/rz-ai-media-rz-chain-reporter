"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

const LightPillar = dynamic(
  () => import("./light-pillar").then((module) => module.LightPillar),
  { ssr: false },
);

type TokenPalette = {
  top: string;
  bottom: string;
};

function resolveTokenColor(host: HTMLElement, token: `--${string}`) {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  host.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function LandingLightPillar() {
  const hostRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [palette, setPalette] = useState<TokenPalette | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !resolvedTheme) return;
    setPalette({
      top: resolveTokenColor(host, "--primary"),
      bottom: resolveTokenColor(host, "--ring"),
    });
  }, [resolvedTheme]);

  const light = resolvedTheme === "light";

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      ref={hostRef}
    >
      {palette && resolvedTheme ? (
        <LightPillar
          bottomColor={palette.bottom}
          lightMode={light}
          topColor={palette.top}
        />
      ) : null}
    </div>
  );
}

export { LandingLightPillar };
