"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

type LightPillarProps = {
  topColor: string;
  bottomColor: string;
  lightMode: boolean;
};

type Appearance = {
  topColor: string;
  bottomColor: string;
  intensity: number;
  rotationSpeed: number;
  glowAmount: number;
  pillarWidth: number;
  pillarHeight: number;
  noiseIntensity: number;
  lightMode: boolean;
};

type PillarUniforms = {
  uTime: { value: number };
  uResolution: { value: THREE.Vector2 };
  uTopColor: { value: THREE.Vector3 };
  uBottomColor: { value: THREE.Vector3 };
  uIntensity: { value: number };
  uGlowAmount: { value: number };
  uPillarWidth: { value: number };
  uPillarHeight: { value: number };
  uNoiseIntensity: { value: number };
  uLightMode: { value: number };
  uRotCos: { value: number };
  uRotSin: { value: number };
  uWaveSin: { value: number };
  uWaveCos: { value: number };
};

type MountedPillar = {
  uniforms: PillarUniforms;
  render: () => void;
  dispose: () => void;
};

function landingAppearance(
  topColor: string,
  bottomColor: string,
  lightMode: boolean,
): Appearance {
  return {
    topColor,
    bottomColor,
    intensity: lightMode ? 0.62 : 0.42,
    rotationSpeed: 0.3,
    glowAmount: 0.0038,
    pillarWidth: 3,
    pillarHeight: 0.4,
    noiseIntensity: 0.18,
    lightMode,
  };
}

const INITIAL_APPEARANCE = landingAppearance("#000000", "#000000", false);

const QUALITY_SETTINGS = {
  low: {
    iterations: 24,
    waveIterations: 1,
    pixelRatio: 0.5,
    stepMultiplier: 1.5,
  },
  medium: {
    iterations: 40,
    waveIterations: 2,
    pixelRatio: 0.65,
    stepMultiplier: 1.2,
  },
} as const;

const MOBILE_UA =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

let colorContext: CanvasRenderingContext2D | null = null;

function parseColor(cssColor: string) {
  if (!colorContext) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    colorContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!colorContext) {
    return new THREE.Vector3(0, 0, 0);
  }
  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillStyle = "#000";
  colorContext.fillStyle = cssColor;
  colorContext.fillRect(0, 0, 1, 1);
  const data = colorContext.getImageData(0, 0, 1, 1).data;
  return new THREE.Vector3(
    (data[0] ?? 0) / 255,
    (data[1] ?? 0) / 255,
    (data[2] ?? 0) / 255,
  );
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function applyAppearance(uniforms: PillarUniforms, appearance: Appearance) {
  uniforms.uTopColor.value = parseColor(appearance.topColor);
  uniforms.uBottomColor.value = parseColor(appearance.bottomColor);
  uniforms.uIntensity.value = appearance.intensity;
  uniforms.uGlowAmount.value = appearance.glowAmount;
  uniforms.uPillarWidth.value = appearance.pillarWidth;
  uniforms.uPillarHeight.value = appearance.pillarHeight;
  uniforms.uNoiseIntensity.value = appearance.noiseIntensity;
  uniforms.uLightMode.value = appearance.lightMode ? 1 : 0;
}

function mountLightPillar(
  container: HTMLElement,
  appearanceRef: { current: Appearance },
): MountedPillar | "unsupported" | null {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width === 0 || height === 0) return null;

  const effectiveQuality = MOBILE_UA.test(navigator.userAgent)
    ? "low"
    : "medium";
  const settings = QUALITY_SETTINGS[effectiveQuality];

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    failIfMajorPerformanceCaveat: false,
    powerPreference: "low-power",
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
  });
  if (!context) return "unsupported" as const;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      canvas,
      context,
      powerPreference: "low-power",
      precision: "mediump",
      stencil: false,
      depth: false,
    });
  } catch {
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return "unsupported" as const;
  }

  renderer.setSize(width, height);
  renderer.setPixelRatio(settings.pixelRatio);
  renderer.domElement.className = "block size-full";
  container.appendChild(renderer.domElement);

  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    precision mediump float;

    uniform float uTime;
    uniform vec2 uResolution;
    uniform vec3 uTopColor;
    uniform vec3 uBottomColor;
    uniform float uIntensity;
    uniform float uGlowAmount;
    uniform float uPillarWidth;
    uniform float uPillarHeight;
    uniform float uNoiseIntensity;
    uniform float uLightMode;
    uniform float uRotCos;
    uniform float uRotSin;
    uniform float uWaveSin;
    uniform float uWaveCos;
    varying vec2 vUv;

    const float STEP_MULT = ${settings.stepMultiplier.toFixed(1)};
    const int MAX_ITER = ${settings.iterations};
    const int WAVE_ITER = ${settings.waveIterations};

    void main() {
      vec2 uv = (vUv * 2.0 - 1.0) * vec2(uResolution.x / uResolution.y, 1.0);

      vec3 ro = vec3(0.0, 0.0, -10.0);
      vec3 rd = normalize(vec3(uv, 1.0));

      float rotC = uRotCos;
      float rotS = uRotSin;

      vec3 col = vec3(0.0);
      float t = 0.1;

      for(int i = 0; i < MAX_ITER; i++) {
        vec3 p = ro + rd * t;
        p.xz = vec2(rotC * p.x - rotS * p.z, rotS * p.x + rotC * p.z);

        vec3 q = p;
        q.y = p.y * uPillarHeight + uTime;

        float freq = 1.0;
        float amp = 1.0;
        for(int j = 0; j < WAVE_ITER; j++) {
          q.xz = vec2(uWaveCos * q.x - uWaveSin * q.z, uWaveSin * q.x + uWaveCos * q.z);
          q += cos(q.zxy * freq - uTime * float(j) * 2.0) * amp;
          freq *= 2.0;
          amp *= 0.5;
        }

        float d = length(cos(q.xz)) - 0.2;
        float bound = length(p.xz) - uPillarWidth;
        float k = 4.0;
        float h = max(k - abs(d - bound), 0.0);
        d = max(d, bound) + h * h * 0.0625 / k;
        d = abs(d) * 0.15 + 0.01;

        float grad = clamp((15.0 - p.y) / 30.0, 0.0, 1.0);
        col += mix(uBottomColor, uTopColor, grad) / d;

        t += d * STEP_MULT;
        if(t > 50.0) break;
      }

      float widthNorm = uPillarWidth / 3.0;
      col = tanh(col * uGlowAmount / widthNorm);

      col -= fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) / 15.0 * uNoiseIntensity;

      vec3 result = clamp(col * uIntensity, 0.0, 1.0);
      if (uLightMode > 0.5) {
        float energy = max(result.r, max(result.g, result.b));
        vec3 hue = result / max(energy, 0.001);
        float coverage = smoothstep(0.025, 0.95, energy);
        hue = pow(clamp(hue, 0.0, 1.0), vec3(1.25));
        result = mix(vec3(1.0), hue, coverage * 0.94);
      }
      gl_FragColor = vec4(result, 1.0);
    }
  `;

  const appearance = appearanceRef.current;
  const uniforms: PillarUniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(width, height) },
    uTopColor: { value: parseColor(appearance.topColor) },
    uBottomColor: { value: parseColor(appearance.bottomColor) },
    uIntensity: { value: appearance.intensity },
    uGlowAmount: { value: appearance.glowAmount },
    uPillarWidth: { value: appearance.pillarWidth },
    uPillarHeight: { value: appearance.pillarHeight },
    uNoiseIntensity: { value: appearance.noiseIntensity },
    uLightMode: { value: appearance.lightMode ? 1 : 0 },
    uRotCos: { value: 1 },
    uRotSin: { value: 0 },
    uWaveSin: { value: Math.sin(0.4) },
    uWaveCos: { value: Math.cos(0.4) },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  scene.add(new THREE.Mesh(geometry, material));

  let time = 0;
  let hidden = document.hidden;

  const render = () => {
    renderer.render(scene, camera);
  };

  const renderFrame = (elapsedMs = 16) => {
    time += elapsedMs * 0.001 * appearanceRef.current.rotationSpeed;
    uniforms.uTime.value = time;
    uniforms.uRotCos.value = Math.cos(time * 0.3);
    uniforms.uRotSin.value = Math.sin(time * 0.3);
    render();
  };

  if (prefersReducedMotion()) {
    renderFrame();
  } else {
    let lastTime = performance.now();
    const targetFPS = effectiveQuality === "low" ? 30 : 60;
    const frameTime = 1000 / targetFPS;

    const animate = (currentTime: number) => {
      const deltaTime = currentTime - lastTime;
      if (!hidden && deltaTime >= frameTime) {
        renderFrame(Math.min(deltaTime, 100));
        lastTime = currentTime - (deltaTime % frameTime);
      } else if (hidden) {
        lastTime = currentTime;
      }
    };
    renderer.setAnimationLoop(animate);
  }

  let resizeTimeout: number | null = null;
  const handleResize = () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = window.setTimeout(() => {
      const nextWidth = container.clientWidth;
      const nextHeight = container.clientHeight;
      renderer.setSize(nextWidth, nextHeight);
      uniforms.uResolution.value.set(nextWidth, nextHeight);
      render();
    }, 150);
  };

  const handleVisibility = () => {
    hidden = document.hidden;
  };

  window.addEventListener("resize", handleResize, { passive: true });
  document.addEventListener("visibilitychange", handleVisibility);

  return {
    uniforms,
    render,
    dispose() {
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      material.dispose();
      geometry.dispose();
    },
  };
}

function LightPillar({ topColor, bottomColor, lightMode }: LightPillarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appearanceRef = useRef<Appearance>(INITIAL_APPEARANCE);
  const sessionRef = useRef<MountedPillar | null>(null);

  useEffect(() => {
    const appearance = landingAppearance(topColor, bottomColor, lightMode);
    appearanceRef.current = appearance;
    const session = sessionRef.current;
    if (!session) return;
    applyAppearance(session.uniforms, appearance);
    session.render();
  }, [topColor, bottomColor, lightMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let session: MountedPillar | undefined;

    const start = () => {
      if (disposed || session) return;
      const mounted = mountLightPillar(container, appearanceRef);
      if (!mounted || mounted === "unsupported") return;
      session = mounted;
      sessionRef.current = mounted;
    };

    start();
    const observer = new ResizeObserver(start);
    observer.observe(container);

    return () => {
      disposed = true;
      observer.disconnect();
      session?.dispose();
      sessionRef.current = null;
    };
  }, []);

  return (
    <div
      aria-hidden
      className="absolute inset-0 size-full"
      ref={containerRef}
    />
  );
}

export { LightPillar };
