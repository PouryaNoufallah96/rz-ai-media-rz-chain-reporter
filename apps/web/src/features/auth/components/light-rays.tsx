"use client";

import { Mesh, Renderer as OglRenderer, Program, Triangle } from "ogl";
import { useEffect, useRef } from "react";

type RaysOrigin = "top-left" | "top-right";
type Rgb = [number, number, number];
type Point = [number, number];

type LightRaysProps = {
  color: Rgb;
  origin: RaysOrigin;
};

type RayUniforms = {
  iTime: { value: number };
  iResolution: { value: [number, number] };
  iRayPosition: { value: [number, number] };
  iRayDirection: { value: [number, number] };
  iRaysColor: { value: Rgb };
  iRaysSpeed: { value: number };
  iLightSpread: { value: number };
  iRayLength: { value: number };
  iOpacity: { value: number };
};

const VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec2 iRayPosition;
uniform vec2 iRayDirection;
uniform vec3 iRaysColor;
uniform float iRaysSpeed;
uniform float iLightSpread;
uniform float iRayLength;
uniform float iOpacity;

out vec4 fragColor;

float rayStrength(
  vec2 raySource,
  vec2 rayReferenceDirection,
  vec2 coord,
  float seedA,
  float seedB,
  float speed
) {
  vec2 sourceToCoord = coord - raySource;
  float distanceFromSource = length(sourceToCoord);
  float alignment = dot(normalize(sourceToCoord), rayReferenceDirection);
  float spread = pow(max(alignment, 0.0), 1.0 / max(iLightSpread, 0.001));
  float maxDistance = iResolution.x * iRayLength;
  float lengthFalloff = 1.0 - smoothstep(0.0, maxDistance, distanceFromSource);
  float variation = clamp(
    (0.45 + 0.15 * sin(alignment * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-alignment * seedB + iTime * speed)),
    0.0,
    1.0
  );

  return variation * lengthFalloff * spread;
}

void main() {
  vec2 coord = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y);
  float firstRay = rayStrength(
    iRayPosition,
    iRayDirection,
    coord,
    36.2214,
    21.11349,
    1.5 * iRaysSpeed
  );
  float secondRay = rayStrength(
    iRayPosition,
    iRayDirection,
    coord,
    22.3991,
    18.0234,
    1.1 * iRaysSpeed
  );
  float strength = pow(
    clamp(firstRay * 0.55 + secondRay * 0.4, 0.0, 1.0),
    1.35
  );
  float verticalFade = 1.0 - clamp(coord.y / iResolution.y, 0.0, 1.0);
  vec3 color = iRaysColor * mix(0.45, 1.0, verticalFade);
  float alpha = strength * verticalFade * iOpacity;

  fragColor = vec4(color * alpha, alpha);
}`;

function canvasPixelRatio() {
  return Math.min(Math.round(window.devicePixelRatio) || 1, 2);
}

function getPlacement(origin: RaysOrigin, width: number, height: number) {
  const anchorY = -0.2 * height;
  return origin === "top-left"
    ? {
        direction: [Math.SQRT1_2, Math.SQRT1_2] as Point,
        position: [0, anchorY] as Point,
      }
    : {
        direction: [-Math.SQRT1_2, Math.SQRT1_2] as Point,
        position: [width, anchorY] as Point,
      };
}

function LightRays({ color, origin }: LightRaysProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uniformsRef = useRef<RayUniforms | null>(null);
  const updateSizeRef = useRef<(() => void) | null>(null);
  const appearanceRef = useRef({ color, origin });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    const webgl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: "default",
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      stencil: false,
    });
    if (!webgl) return;

    let oglRenderer: OglRenderer;
    try {
      oglRenderer = new OglRenderer({
        alpha: true,
        canvas,
        depth: false,
        dpr: canvasPixelRatio(),
        premultipliedAlpha: true,
        webgl: 2,
      });
    } catch {
      webgl.getExtension("WEBGL_lose_context")?.loseContext();
      return;
    }

    const gl = oglRenderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.canvas.className = "block size-full bg-transparent";
    container.replaceChildren(gl.canvas);

    const uniforms: RayUniforms = {
      iTime: { value: 0 },
      iResolution: { value: [1, 1] },
      iRayPosition: { value: [0, 0] },
      iRayDirection: { value: [0, 1] },
      iRaysColor: { value: appearanceRef.current.color },
      iRaysSpeed: { value: 0.45 },
      iLightSpread: { value: 0.24 },
      iRayLength: { value: 1.55 },
      iOpacity: { value: 0.9 },
    };
    uniformsRef.current = uniforms;

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      depthTest: false,
      depthWrite: false,
      fragment: FRAGMENT,
      uniforms,
      vertex: VERTEX,
    });
    const mesh = new Mesh(gl, { frustumCulled: false, geometry, program });
    let lastRenderTime = 0;

    const render = (time: number) => {
      lastRenderTime = time;
      uniforms.iTime.value = time * 0.001;
      oglRenderer.render({ scene: mesh });
    };

    const updateSize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;

      oglRenderer.dpr = canvasPixelRatio();
      oglRenderer.setSize(width, height);
      const pixelWidth = Math.round(width * oglRenderer.dpr);
      const pixelHeight = Math.round(height * oglRenderer.dpr);
      uniforms.iResolution.value = [pixelWidth, pixelHeight];
      const placement = getPlacement(
        appearanceRef.current.origin,
        pixelWidth,
        pixelHeight,
      );
      uniforms.iRayPosition.value = placement.position;
      uniforms.iRayDirection.value = placement.direction;
      render(lastRenderTime);
    };
    updateSizeRef.current = updateSize;
    updateSize();

    let animationId: number | null = null;
    let hidden = document.hidden;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      let elapsedTime = 0;
      let previousTime: number | null = null;

      const loop = (time: number) => {
        if (previousTime === null) previousTime = time;
        if (!hidden) {
          elapsedTime += Math.min(time - previousTime, 100);
          render(elapsedTime);
        }
        previousTime = time;

        animationId = requestAnimationFrame(loop);
      };
      animationId = requestAnimationFrame(loop);
    }

    const handleVisibility = () => {
      hidden = document.hidden;
    };
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      if (animationId !== null) cancelAnimationFrame(animationId);
      updateSizeRef.current = null;
      uniformsRef.current = null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      if (container.contains(gl.canvas)) container.removeChild(gl.canvas);
    };
  }, []);

  useEffect(() => {
    appearanceRef.current = { color, origin };
    const uniforms = uniformsRef.current;
    if (uniforms) uniforms.iRaysColor.value = color;
    updateSizeRef.current?.();
  }, [color, origin]);

  return (
    <div
      aria-hidden
      className="ltr:mask-[linear-gradient(to_right,transparent,black_28%)] rtl:mask-[linear-gradient(to_left,transparent,black_28%)] absolute inset-e-0 top-0 h-[min(48rem,80svh)] w-full overflow-hidden sm:w-[min(44rem,65vw)]"
      ref={containerRef}
    />
  );
}

export type { Rgb };
export { LightRays };
