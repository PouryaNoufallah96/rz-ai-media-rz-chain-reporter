import sharp, { type OverlayOptions } from "sharp";

import { fitToCanvas } from "../image-assembler";

const FOOTER_LOCKUP_MAX_WIDTH_RATIO = 0.22;
const FOOTER_LOCKUP_MAX_HEIGHT_SHORT_SIDE_RATIO = 0.05;
const FOOTER_LOCKUP_BOTTOM_MARGIN_RATIO = 0.025;
const FOOTER_PLATE_OPACITY = 0.86;
const FOOTER_PLATE_CONTRAST_FLOOR = 0.35;
const FOOTER_PLATE_BUSY_EDGE_STDDEV = 20;
const FOOTER_PLATE_PADDING_X_RATIO = 0.6;
const FOOTER_PLATE_PADDING_Y_RATIO = 0.4;

function luminance(r: number, g: number, b: number) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

async function lockupLuminance(lockup: Buffer) {
  const { data, info } = await sharp(lockup)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let weighted = 0;
  let alpha = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const a = (data[offset + 3] ?? 0) / 255;
    if (a === 0) continue;
    weighted +=
      luminance(
        data[offset] ?? 0,
        data[offset + 1] ?? 0,
        data[offset + 2] ?? 0,
      ) * a;
    alpha += a;
  }
  return alpha === 0 ? 1 : weighted / alpha;
}

const LAPLACIAN = {
  width: 3,
  height: 3,
  kernel: [0, -1, 0, -1, 4, -1, 0, -1, 0],
  scale: 1,
  offset: 128,
};

async function regionStats(
  canvas: Buffer,
  region: { height: number; left: number; top: number; width: number },
) {
  const slot = await sharp(canvas).extract(region).removeAlpha().toBuffer();
  const [{ channels }, edges] = await Promise.all([
    sharp(slot).stats(),
    sharp(slot).greyscale().convolve(LAPLACIAN).stats(),
  ]);
  const tone = luminance(
    channels[0]?.mean ?? 0,
    channels[1]?.mean ?? 0,
    channels[2]?.mean ?? 0,
  );
  return { detail: edges.channels[0]?.stdev ?? 0, tone };
}

function hexLuminance(color: string) {
  const value = Number.parseInt(color.slice(1), 16);
  return luminance((value >> 16) & 255, (value >> 8) & 255, value & 255);
}

function footerPlate(
  region: { height: number; left: number; top: number; width: number },
  color: string,
) {
  const radius = Math.round(region.height / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${region.width}" height="${region.height}"><rect x="0" y="0" width="${region.width}" height="${region.height}" rx="${radius}" ry="${radius}" fill="${color}" fill-opacity="${FOOTER_PLATE_OPACITY}"/></svg>`;
  return Buffer.from(svg);
}

export async function composeCenteredRail(input: {
  footerLockup: Uint8Array;
  footerRailHeightRatio: number;
  height: number;
  plateColor: string;
  providerOriginal: Uint8Array;
  width: number;
}) {
  const shortSide = Math.min(input.width, input.height);
  const canvas = await fitToCanvas(
    input.providerOriginal,
    input.width,
    input.height,
  );
  const footer = await sharp(input.footerLockup)
    .resize({
      fit: "inside",
      height: Math.max(
        1,
        Math.round(shortSide * FOOTER_LOCKUP_MAX_HEIGHT_SHORT_SIDE_RATIO),
      ),
      width: Math.max(
        1,
        Math.round(input.width * FOOTER_LOCKUP_MAX_WIDTH_RATIO),
      ),
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const metadata = await sharp(footer).metadata();
  const footerWidth = metadata.width ?? 1;
  const footerHeight = metadata.height ?? 1;
  const left = Math.max(0, Math.round((input.width - footerWidth) / 2));
  const top = Math.max(
    0,
    input.height -
      Math.round(input.height * FOOTER_LOCKUP_BOTTOM_MARGIN_RATIO) -
      footerHeight,
  );
  const paddingX = Math.round(footerHeight * FOOTER_PLATE_PADDING_X_RATIO);
  const paddingY = Math.round(footerHeight * FOOTER_PLATE_PADDING_Y_RATIO);
  const plate = {
    left: Math.max(0, left - paddingX),
    top: Math.max(0, top - paddingY),
    width: Math.min(input.width, footerWidth + paddingX * 2),
    height: Math.min(input.height, footerHeight + paddingY * 2),
  };
  plate.width = Math.min(plate.width, input.width - plate.left);
  plate.height = Math.min(plate.height, input.height - plate.top);
  const [lockupTone, slot] = await Promise.all([
    lockupLuminance(footer),
    regionStats(canvas, plate),
  ]);
  const layers: OverlayOptions[] = [];
  if (
    slot.detail > FOOTER_PLATE_BUSY_EDGE_STDDEV ||
    Math.abs(lockupTone - slot.tone) < FOOTER_PLATE_CONTRAST_FLOOR
  ) {
    const themed =
      Math.abs(lockupTone - hexLuminance(input.plateColor)) >=
      FOOTER_PLATE_CONTRAST_FLOOR;
    layers.push({
      input: footerPlate(
        plate,
        themed ? input.plateColor : lockupTone >= 0.5 ? "#000000" : "#ffffff",
      ),
      left: plate.left,
      top: plate.top,
    });
  }
  layers.push({ input: footer, left, top });
  return sharp(canvas).composite(layers).png().toBuffer();
}
