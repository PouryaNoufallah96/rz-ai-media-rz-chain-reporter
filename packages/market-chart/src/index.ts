import {
  type ContentLocale,
  MARKET_CHART_MIN_COLOR_CONTRAST,
  MARKET_CHART_RENDER_CONTRACT_VERSION,
  type MarketChartPresetId,
  type MarketChartRenderInput,
  type MarketChartSpec,
  marketChartColorContrast,
  marketChartRenderInputSchema,
  marketChartSpecSchema,
  marketChartSpecShapeSchema,
} from "@rz-chain-reporter/contracts";
import {
  DIRECTION,
  type Direction,
  FONT_FAMILY,
  type FontFamily,
  INTL_LOCALE,
} from "@rz-chain-reporter/i18n";

export { MARKET_CHART_RENDER_CONTRACT_VERSION as renderContractVersion };

const AXIS_TICK_COUNT = 5;
const GAP_FACTOR = 2.5;
const COORDINATE_PRECISION = 3;
const LEGEND_ITEM_HEIGHT = 40;
const LEGEND_FONT_SIZE = 24;
const LEGEND_CHAR_WIDTH = 0.58;
const LEGEND_MARKER_WIDTH = 28;
const LEGEND_GAP = 40;
const LEGEND_INSET = 12;
const PLOT_LEGEND_GAP = 24;
const X_AXIS_RESERVE = 60;

export const MARKET_CHART_PRESETS = {
  "clean-light": {
    background: "#ffffff",
    colors: ["#1d4ed8", "#b91c1c", "#047857", "#6d28d9", "#9f1239", "#0f766e"],
    legendPosition: "bottom",
    legendFormat: "symbol_change",
    lineWidth: 4,
    markers: "endpoints",
    gridStrength: "subtle",
  },
  "brand-dark": {
    background: "#0f172a",
    colors: ["#a78bfa", "#22d3ee", "#4ade80", "#fbbf24", "#fb7185", "#f472b6"],
    legendPosition: "overlay-top-right",
    legendFormat: "symbol_change",
    lineWidth: 4,
    markers: "endpoints",
    gridStrength: "subtle",
  },
  "high-contrast": {
    background: "#000000",
    colors: ["#ffffff", "#00ffff", "#ffff00", "#00ff66", "#ff66ff", "#ff9900"],
    legendPosition: "top",
    legendFormat: "symbol_change",
    lineWidth: 6,
    markers: "all",
    gridStrength: "standard",
  },
  "color-blind-safe": {
    background: "#ffffff",
    colors: ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#000000", "#6f4e7c"],
    legendPosition: "right",
    legendFormat: "symbol_only",
    lineWidth: 6,
    markers: "endpoints",
    gridStrength: "standard",
  },
} as const satisfies Record<
  MarketChartPresetId,
  Omit<MarketChartSpec, "schemaVersion" | "presetId" | "seriesColors"> & {
    colors: readonly string[];
  }
>;

export type MarketChartScene = {
  width: number;
  height: number;
  locale: ContentLocale;
  direction: Direction;
  fontFamily: FontFamily;
  background: string;
  foreground: string;
  muted: string;
  grid: string;
  plot: { x: number; y: number; width: number; height: number };
  xTicks: readonly { x: number; label: string; timestamp: string }[];
  yTicks: readonly { y: number; label: string; value: number }[];
  series: readonly {
    id: string;
    label: string;
    symbol: string;
    color: string;
    glyph: "circle" | "diamond" | "square" | "triangle";
    lineWidth: number;
    segments: readonly (readonly { x: number; y: number }[])[];
    markers: readonly { x: number; y: number }[];
    interaction: readonly {
      x: number;
      y: number;
      timestamp: string;
      value: string;
      announcement: string;
    }[];
    legend: string;
  }[];
  failedSeries: readonly { id: string; label: string; failureCode: string }[];
  legend: {
    position: MarketChartSpec["legendPosition"];
    layout: "horizontal" | "vertical" | "overlay";
    x: number;
    y: number;
    width: number;
    height: number;
    items: readonly { x: number; y: number }[];
  };
  gridStrength: MarketChartSpec["gridStrength"];
  attribution: null | {
    y: number;
    height: number;
    entries: readonly { identity: string; text: string; href?: string }[];
  };
};

export class MarketChartError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MarketChartError";
  }
}

function validationErrorCode(issues: readonly { message: string }[]) {
  if (
    issues.some(
      (issue) => issue.message === "market_chart_series_color_duplicate",
    )
  ) {
    return "SERIES_COLOR_DUPLICATE";
  }
  if (
    issues.some(
      (issue) => issue.message === "market_chart_series_color_contrast",
    )
  ) {
    return "SERIES_COLOR_CONTRAST";
  }
  return "CHART_SPEC_INVALID";
}

function round(value: number) {
  return Number(value.toFixed(COORDINATE_PRECISION));
}

function normalizeHex(value: string) {
  return value.toLowerCase();
}

function rgb(hex: string) {
  return [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  ) as [number, number, number];
}

function alphaBlend(foreground: string, background: string, alpha: number) {
  const front = rgb(foreground);
  const back = rgb(background);
  const channels = front.map((value, index) =>
    Math.round(value * alpha + (back[index] ?? 0) * (1 - alpha)),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

const previewRenderInputSchema = marketChartRenderInputSchema.extend({
  spec: marketChartSpecShapeSchema,
});

export function normalizeMarketChartSpec(spec: MarketChartSpec) {
  const result = marketChartSpecSchema.safeParse(spec);
  if (!result.success) {
    throw new MarketChartError(validationErrorCode(result.error.issues));
  }
  return normalizeParsedMarketChartSpec(result.data);
}

function normalizeParsedMarketChartSpec(parsed: MarketChartSpec) {
  return {
    ...parsed,
    background: normalizeHex(parsed.background),
    presetId: parsed.presetId.normalize("NFC"),
    seriesColors: Object.fromEntries(
      Object.entries(parsed.seriesColors)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([id, color]) => [id.normalize("NFC"), normalizeHex(color)]),
    ),
  } satisfies MarketChartSpec;
}

export function applyMarketChartPreset(
  spec: MarketChartSpec,
  presetId: MarketChartPresetId,
  seriesIdentities: readonly string[],
) {
  const { colors, ...preset } = MARKET_CHART_PRESETS[presetId];
  return normalizeMarketChartSpec({
    ...spec,
    ...preset,
    presetId,
    seriesColors: Object.fromEntries(
      seriesIdentities.map((identity, index) => [
        identity,
        colors[index % colors.length] ?? colors[0],
      ]),
    ),
  });
}

export function materialMarketChartSpec(spec: MarketChartSpec) {
  const { presetId: _presetId, ...material } = normalizeMarketChartSpec(spec);
  return material;
}

export function formatMarketValue(
  locale: ContentLocale,
  value: number,
  scale: MarketChartRenderInput["snapshot"]["scale"],
) {
  if (!Number.isFinite(value)) throw new MarketChartError("VALUE_NOT_FINITE");
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    compactDisplay: "short",
    maximumFractionDigits: scale === "relative" ? 2 : 4,
    minimumFractionDigits: 0,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    signDisplay: "auto",
    useGrouping: true,
  }).format(value);
}

export function formatMarketPercent(locale: ContentLocale, value: number) {
  if (!Number.isFinite(value)) throw new MarketChartError("VALUE_NOT_FINITE");
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    signDisplay: "exceptZero",
    style: "percent",
    useGrouping: false,
  }).format(value / 100);
}

export function formatMarketTimestamp(
  locale: ContentLocale,
  period: MarketChartRenderInput["snapshot"]["period"],
  timestamp: string | Date,
) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime()))
    throw new MarketChartError("TIMESTAMP_INVALID");
  const options: Intl.DateTimeFormatOptions =
    period === "24h"
      ? {
          calendar: "gregory",
          hour: "2-digit",
          hourCycle: "h23",
          minute: "2-digit",
          month: "short",
          day: "2-digit",
          timeZone: "UTC",
        }
      : period === "1y"
        ? {
            calendar: "gregory",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          }
        : {
            calendar: "gregory",
            day: "2-digit",
            month: "short",
            timeZone: "UTC",
          };
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], options).format(date);
}

function parsePrice(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new MarketChartError("PRICE_INVALID");
  return parsed;
}

function domain(values: readonly number[]) {
  if (values.length === 0) throw new MarketChartError("SERIES_REQUIRED");
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  const padding =
    span === 0 ? Math.max(Math.abs(minimum) * 0.05, 1) : span * 0.08;
  return { minimum: minimum - padding, maximum: maximum + padding };
}

function linear(value: number, from: [number, number], to: [number, number]) {
  if (from[0] === from[1]) return round((to[0] + to[1]) / 2);
  return round(
    to[0] + ((value - from[0]) / (from[1] - from[0])) * (to[1] - to[0]),
  );
}

function deterministicTicks(minimum: number, maximum: number) {
  return Array.from({ length: AXIS_TICK_COUNT }, (_, index) =>
    round(minimum + ((maximum - minimum) * index) / (AXIS_TICK_COUNT - 1)),
  );
}

function median(values: readonly number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const left = ordered[middle - 1];
  const right = ordered[middle];
  if (right === undefined) return 0;
  return ordered.length % 2 === 0 && left !== undefined
    ? (left + right) / 2
    : right;
}

function segmentPoints<T extends { timestampMs: number }>(
  points: readonly T[],
) {
  if (points.length < 2) return [points];
  const deltas = points
    .slice(1)
    .map(
      (point, index) => point.timestampMs - (points[index]?.timestampMs ?? 0),
    )
    .filter((delta) => delta > 0);
  const threshold = median(deltas) * GAP_FACTOR;
  const segments: T[][] = [[]];
  for (const point of points) {
    const current = segments.at(-1);
    if (!current) throw new MarketChartError("SEGMENT_MISSING");
    const previous = current.at(-1);
    if (
      previous &&
      threshold > 0 &&
      point.timestampMs - previous.timestampMs > threshold
    ) {
      segments.push([point]);
    } else {
      current.push(point);
    }
  }
  return segments;
}

function markerPoints(
  points: readonly { x: number; y: number }[],
  markers: MarketChartSpec["markers"],
) {
  if (markers === "none") return [];
  if (markers === "all") return points.map(({ x, y }) => ({ x, y }));
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return [];
  return first === last
    ? [{ x: first.x, y: first.y }]
    : [
        { x: first.x, y: first.y },
        { x: last.x, y: last.y },
      ];
}

function glyph(index: number): MarketChartScene["series"][number]["glyph"] {
  return ["circle", "diamond", "square", "triangle"][index % 4] as
    | "circle"
    | "diamond"
    | "square"
    | "triangle";
}

function legendLabel(
  locale: ContentLocale,
  format: MarketChartSpec["legendFormat"],
  input: {
    symbol: string;
    changePercent: number;
  },
) {
  if (format === "symbol_only") return input.symbol;
  return `${input.symbol} ${formatMarketPercent(locale, input.changePercent)}`;
}

function legendItemWidth(label: string) {
  return (
    LEGEND_MARKER_WIDTH +
    Math.ceil(label.length * LEGEND_FONT_SIZE * LEGEND_CHAR_WIDTH)
  );
}

function packLegendRows(itemWidths: readonly number[], available: number) {
  const rows: number[][] = [];
  let row: number[] = [];
  let cursor = 0;
  for (const itemWidth of itemWidths) {
    if (row.length > 0 && cursor + itemWidth > available) {
      rows.push(row);
      row = [];
      cursor = 0;
    }
    row.push(cursor);
    cursor += itemWidth + LEGEND_GAP;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

function chartLayout(
  input: MarketChartRenderInput,
  attributionCount: number,
  legendLabels: readonly string[],
) {
  const { width, height } = input.dimensions;
  const outer = Math.max(40, Math.round(Math.min(width, height) * 0.055));
  const attributionHeight =
    attributionCount > 0 ? Math.max(56, Math.round(height * 0.055)) : 0;
  const bottomEdge = height - outer - attributionHeight;
  const position = input.spec.legendPosition;
  const horizontal = position === "top" || position === "bottom";
  const vertical = position === "left" || position === "right";
  const overlay =
    position === "overlay-top-right" || position === "overlay-bottom-right";
  const itemWidths = legendLabels.map(legendItemWidth);
  const widestItem = Math.max(0, ...itemWidths);
  const sideLegendWidth = vertical
    ? Math.min(Math.round(width * 0.3), Math.max(160, widestItem + 8))
    : 0;
  const plotX =
    outer + 96 + (position === "left" ? sideLegendWidth + PLOT_LEGEND_GAP : 0);
  const plotWidth =
    position === "right"
      ? width - outer - sideLegendWidth - PLOT_LEGEND_GAP - plotX
      : width - plotX - outer - 16;
  const rows = horizontal ? packLegendRows(itemWidths, plotWidth) : [];
  const horizontalLegendHeight = horizontal
    ? rows.length * LEGEND_ITEM_HEIGHT + 8
    : 0;
  const plotY =
    outer +
    12 +
    (position === "top" ? horizontalLegendHeight + PLOT_LEGEND_GAP : 0);
  const plotBottom =
    (position === "bottom"
      ? bottomEdge - horizontalLegendHeight - PLOT_LEGEND_GAP
      : bottomEdge) - X_AXIS_RESERVE;
  const plot = {
    x: plotX,
    y: plotY,
    width: plotWidth,
    height: plotBottom - plotY,
  };
  if (plot.width < 320 || plot.height < 320)
    throw new MarketChartError("PLOT_TOO_SMALL");
  const overlayWidth = Math.min(
    Math.round(plot.width * 0.6),
    Math.max(200, widestItem + 32),
  );
  const overlayHeight = Math.min(
    plot.height - 2 * LEGEND_INSET,
    legendLabels.length * LEGEND_ITEM_HEIGHT + 8,
  );
  const box = vertical
    ? {
        x: position === "left" ? outer : width - outer - sideLegendWidth,
        y: plot.y,
        width: sideLegendWidth,
        height: plot.height,
        layout: "vertical" as const,
      }
    : overlay
      ? {
          x: plot.x + plot.width - overlayWidth - LEGEND_INSET,
          y:
            position === "overlay-top-right"
              ? plot.y + LEGEND_INSET
              : plot.y + plot.height - overlayHeight - LEGEND_INSET,
          width: overlayWidth,
          height: overlayHeight,
          layout: "overlay" as const,
        }
      : {
          x: plot.x,
          y: position === "top" ? outer : bottomEdge - horizontalLegendHeight,
          width: plot.width,
          height: horizontalLegendHeight,
          layout: "horizontal" as const,
        };
  const items =
    box.layout === "horizontal"
      ? rows.flatMap((row, rowIndex) =>
          row.map((start) => ({
            x: round(box.x + start),
            y: round(box.y + rowIndex * LEGEND_ITEM_HEIGHT + 28),
          })),
        )
      : legendLabels.map((_, index) => ({
          x: round(box.x + (box.layout === "overlay" ? 16 : 0)),
          y: round(
            box.y +
              index * LEGEND_ITEM_HEIGHT +
              (box.layout === "overlay" ? 28 : 20),
          ),
        }));
  return {
    attributionHeight,
    legend: { ...box, position, items },
    outer,
    plot,
  };
}

export function createMarketChartScene(
  rawInput: MarketChartRenderInput,
  options: { enforceColorPolicy?: boolean } = {},
) {
  const enforceColorPolicy = options.enforceColorPolicy ?? true;
  const result = (
    enforceColorPolicy ? marketChartRenderInputSchema : previewRenderInputSchema
  ).safeParse(rawInput);
  if (!result.success) {
    throw new MarketChartError(validationErrorCode(result.error.issues));
  }
  const input = result.data;
  const spec = normalizeParsedMarketChartSpec(input.spec);
  const successful = input.snapshot.series.filter(
    (series) => series.outcome === "succeeded",
  );
  if (successful.length === 0)
    throw new MarketChartError("NO_SUCCESSFUL_SERIES");
  const attribution = input.attribution
    .filter((entry) => entry.required && entry.chartLevel)
    .sort((left, right) => left.identity.localeCompare(right.identity, "en"));
  const legendLabels = successful.map((entry) => {
    const changePercent = Number(entry.changePercent);
    if (!Number.isFinite(changePercent))
      throw new MarketChartError("CHANGE_PERCENT_INVALID");
    return legendLabel(input.contentLocale, spec.legendFormat, {
      symbol: entry.symbol,
      changePercent,
    });
  });
  const { attributionHeight, legend, outer, plot } = chartLayout(
    { ...input, spec },
    attribution.length,
    legendLabels,
  );
  const foreground =
    marketChartColorContrast(spec.background, "#ffffff") >= 4.5
      ? "#ffffff"
      : "#111827";
  const muted = alphaBlend(foreground, spec.background, 0.62);
  const gridAlpha =
    spec.gridStrength === "none"
      ? 0
      : spec.gridStrength === "subtle"
        ? 0.12
        : 0.22;
  const grid = alphaBlend(foreground, spec.background, gridAlpha);
  const startMs = new Date(input.snapshot.effectiveWindowStart).getTime();
  const endMs = new Date(input.snapshot.effectiveWindowEnd).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs)
    throw new MarketChartError("WINDOW_INVALID");

  const activeColors = input.snapshot.series.map((entry) => {
    const color = spec.seriesColors[entry.id];
    if (!color) throw new MarketChartError("SERIES_COLOR_MISSING");
    if (
      enforceColorPolicy &&
      marketChartColorContrast(color, spec.background) <
        MARKET_CHART_MIN_COLOR_CONTRAST
    )
      throw new MarketChartError("SERIES_COLOR_CONTRAST");
    return normalizeHex(color);
  });
  if (
    enforceColorPolicy &&
    new Set(activeColors).size !== activeColors.length
  ) {
    throw new MarketChartError("SERIES_COLOR_DUPLICATE");
  }

  const factual = successful.map((series) => {
    const ordered = series.points
      .map(([timestamp, price]) => ({
        timestamp,
        timestampMs: new Date(timestamp).getTime(),
        rawValue: parsePrice(price),
      }))
      .sort((left, right) => left.timestampMs - right.timestampMs);
    if (
      ordered.some(
        (point, index) =>
          !Number.isFinite(point.timestampMs) ||
          point.timestampMs < startMs ||
          point.timestampMs > endMs ||
          (index > 0 && point.timestampMs === ordered[index - 1]?.timestampMs),
      )
    ) {
      throw new MarketChartError("POINT_ORDER_INVALID");
    }
    const base = ordered[0]?.rawValue;
    if (!base) throw new MarketChartError("SERIES_BASE_INVALID");
    return {
      ...series,
      points: ordered.map((point) => ({
        ...point,
        value:
          input.snapshot.scale === "relative"
            ? (point.rawValue / base) * 100
            : point.rawValue,
      })),
    };
  });
  const yDomain = domain(
    factual.flatMap((series) => series.points.map((point) => point.value)),
  );
  const yValues = deterministicTicks(yDomain.minimum, yDomain.maximum);
  const xValues = deterministicTicks(startMs, endMs);
  const xTicks = xValues.map((value) => {
    const timestamp = new Date(value).toISOString();
    return {
      x: linear(value, [startMs, endMs], [plot.x, plot.x + plot.width]),
      label: formatMarketTimestamp(
        input.contentLocale,
        input.snapshot.period,
        timestamp,
      ),
      timestamp,
    };
  });
  const yTicks = yValues.map((value) => ({
    y: linear(
      value,
      [yDomain.minimum, yDomain.maximum],
      [plot.y + plot.height, plot.y],
    ),
    label: formatMarketValue(input.contentLocale, value, input.snapshot.scale),
    value,
  }));
  const series = factual.map((entry, index) => {
    const color = spec.seriesColors[entry.id];
    if (!color) throw new MarketChartError("SERIES_COLOR_MISSING");
    const projected = entry.points.map((point) => ({
      ...point,
      x: linear(
        point.timestampMs,
        [startMs, endMs],
        [plot.x, plot.x + plot.width],
      ),
      y: linear(
        point.value,
        [yDomain.minimum, yDomain.maximum],
        [plot.y + plot.height, plot.y],
      ),
    }));
    const last = projected.at(-1);
    if (!last) throw new MarketChartError("SERIES_REQUIRED");
    return {
      id: entry.id,
      label: entry.label,
      symbol: entry.symbol,
      color,
      glyph: glyph(index),
      lineWidth: spec.lineWidth,
      segments: segmentPoints(projected).map((segment) =>
        segment.map(({ x, y }) => ({ x, y })),
      ),
      markers: markerPoints(projected, spec.markers),
      interaction: projected.map((point) => {
        const value = formatMarketValue(
          input.contentLocale,
          point.value,
          input.snapshot.scale,
        );
        const date = formatMarketTimestamp(
          input.contentLocale,
          input.snapshot.period,
          point.timestamp,
        );
        return {
          x: point.x,
          y: point.y,
          timestamp: point.timestamp,
          value,
          announcement: `${entry.label}, ${date}, ${value}`,
        };
      }),
      legend: legendLabels[index] ?? entry.symbol,
    };
  });

  return {
    width: input.dimensions.width,
    height: input.dimensions.height,
    locale: input.contentLocale,
    direction: DIRECTION[input.contentLocale],
    fontFamily: FONT_FAMILY[input.contentLocale],
    background: spec.background,
    foreground,
    muted,
    grid,
    plot,
    xTicks,
    yTicks,
    series,
    failedSeries: input.snapshot.series
      .filter((entry) => entry.outcome === "failed")
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        failureCode: entry.failureCode,
      })),
    legend,
    gridStrength: spec.gridStrength,
    attribution:
      attribution.length === 0
        ? null
        : {
            y: input.dimensions.height - outer - attributionHeight,
            height: attributionHeight,
            entries: attribution.map(({ identity, text, href }) => ({
              identity,
              text,
              ...(href ? { href } : {}),
            })),
          },
  } satisfies MarketChartScene;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function pointPath(points: readonly { x: number; y: number }[]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
}

function glyphMarkup(
  shape: MarketChartScene["series"][number]["glyph"],
  x: number,
  y: number,
  size: number,
  color: string,
) {
  if (shape === "circle")
    return `<circle cx="${x}" cy="${y}" r="${size}" fill="${color}"/>`;
  if (shape === "square")
    return `<rect x="${round(x - size)}" y="${round(y - size)}" width="${size * 2}" height="${size * 2}" fill="${color}"/>`;
  if (shape === "diamond")
    return `<path d="M${x} ${round(y - size)} L${round(x + size)} ${y} L${x} ${round(y + size)} L${round(x - size)} ${y} Z" fill="${color}"/>`;
  return `<path d="M${x} ${round(y - size)} L${round(x + size)} ${round(y + size)} L${round(x - size)} ${round(y + size)} Z" fill="${color}"/>`;
}

export function serializeMarketChartSvg(scene: MarketChartScene) {
  const title = scene.locale === "fa" ? "نمودار بازار" : "Market chart";
  const unavailable =
    scene.locale === "fa" ? "داده در دسترس نیست" : "Data unavailable";
  const elements: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" role="img" aria-labelledby="market-chart-title market-chart-desc">`,
    `<title id="market-chart-title">${title}</title>`,
    `<desc id="market-chart-desc">${escapeXml(scene.series.map((entry) => entry.legend).join(", "))}</desc>`,
    `<rect width="${scene.width}" height="${scene.height}" fill="${scene.background}"/>`,
    `<g font-family="${scene.fontFamily}" font-size="24" fill="${scene.foreground}" direction="${scene.direction}">`,
  ];
  for (const tick of scene.yTicks) {
    if (scene.grid !== scene.background) {
      elements.push(
        `<line x1="${scene.plot.x}" y1="${tick.y}" x2="${round(scene.plot.x + scene.plot.width)}" y2="${tick.y}" stroke="${scene.grid}" stroke-width="1"/>`,
      );
    }
    elements.push(
      `<text x="${round(scene.plot.x - 24)}" y="${round(tick.y + 8)}" text-anchor="end" direction="ltr">${escapeXml(tick.label)}</text>`,
    );
  }
  for (const tick of scene.xTicks) {
    if (scene.gridStrength === "standard") {
      elements.push(
        `<line x1="${tick.x}" y1="${scene.plot.y}" x2="${tick.x}" y2="${round(scene.plot.y + scene.plot.height)}" stroke="${scene.grid}" stroke-width="1"/>`,
      );
    }
    elements.push(
      `<text x="${tick.x}" y="${round(scene.plot.y + scene.plot.height + 44)}" text-anchor="middle" direction="ltr">${escapeXml(tick.label)}</text>`,
    );
  }
  elements.push(
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`,
  );
  for (const entry of scene.series) {
    for (const segment of entry.segments) {
      elements.push(
        `<path d="${pointPath(segment)}" stroke="${entry.color}" stroke-width="${entry.lineWidth}"/>`,
      );
    }
  }
  elements.push("</g>");
  for (const entry of scene.series) {
    for (const marker of entry.markers) {
      elements.push(
        glyphMarkup(entry.glyph, marker.x, marker.y, 5, entry.color),
      );
    }
  }
  if (scene.legend.layout === "overlay") {
    elements.push(
      `<rect x="${scene.legend.x}" y="${scene.legend.y}" width="${scene.legend.width}" height="${scene.legend.height}" rx="12" fill="${scene.background}" fill-opacity="0.92" stroke="${scene.grid}"/>`,
    );
  }
  scene.series.forEach((entry, index) => {
    const item = scene.legend.items[index];
    if (!item) return;
    const markerX = item.x + 8;
    elements.push(
      glyphMarkup(entry.glyph, markerX, item.y - 6, 7, entry.color),
    );
    elements.push(
      `<text x="${markerX + 20}" y="${item.y}" text-anchor="start" direction="ltr">${escapeXml(entry.legend)}</text>`,
    );
  });
  scene.failedSeries.forEach((entry, index) => {
    const x =
      scene.direction === "rtl"
        ? round(scene.plot.x + scene.plot.width)
        : scene.plot.x;
    elements.push(
      `<text x="${x}" y="${round(scene.plot.y + 30 + index * 30)}" fill="${scene.muted}" text-anchor="start" direction="${scene.direction}">${escapeXml(`${unavailable}: ${entry.label}`)}</text>`,
    );
  });
  if (scene.attribution) {
    elements.push(
      `<line x1="${scene.plot.x}" y1="${scene.attribution.y}" x2="${round(scene.plot.x + scene.plot.width)}" y2="${scene.attribution.y}" stroke="${scene.grid}" stroke-width="1"/>`,
    );
    elements.push(
      `<text x="${scene.plot.x}" y="${round(scene.attribution.y + scene.attribution.height / 2 + 8)}" fill="${scene.muted}" font-size="20" text-anchor="start" direction="ltr">${escapeXml(scene.attribution.entries.map((entry) => entry.text).join(" · "))}</text>`,
    );
  }
  elements.push("</g>", "</svg>");
  return elements.join("");
}

export function renderMarketChartSvg(input: MarketChartRenderInput) {
  return serializeMarketChartSvg(createMarketChartScene(input));
}
