import { createHash } from "node:crypto";
import type {
  ContentLocale,
  CreativeImageBrief,
  TemplateSelection,
} from "@rz-chain-reporter/contracts";
import type { ImageProfile } from "@rz-chain-reporter/customer-template/schema";
import sharp from "sharp";

export const IMAGE_ASSEMBLER_VERSION = "image-assembler-v1";

export function imageTextLanguageInstruction(contentLocale: ContentLocale) {
  return contentLocale === "fa"
    ? "Content locale: fa (Persian). Every visible text element in the image, including the headline, labels, badges, and word-based data, must be written in Persian. Do not substitute the operator UI language or the source language."
    : "Content locale: en (English). Every visible text element in the image, including the headline, labels, badges, and word-based data, must be written in English. Do not substitute the operator UI language or the source language.";
}

export function assembleImagePrompt(input: {
  brief: CreativeImageBrief;
  brandBible: string;
  contentLocale: ContentLocale;
  operatorDirection?: string;
  profile: ImageProfile;
  selection: TemplateSelection;
}) {
  const family = input.profile.families[input.selection.family];
  if (!family) throw new Error("IMAGE_SELECTION_INVALID");
  const axisLines = Object.entries(input.selection.axes).flatMap(
    ([axisName, value]) => {
      if (value === null) return [];
      const description = input.profile.axes[axisName]?.[value];
      return description === undefined ? [] : [`${axisName}: ${description}`];
    },
  );
  const data = input.brief.dataElements
    .map((item) => `${item.value}${item.label ? ` — ${item.label}` : ""}`)
    .join("; ");
  const prompt = [
    `Assembler: ${IMAGE_ASSEMBLER_VERSION}`,
    input.profile.frozenStyle.format,
    input.profile.frozenStyle.palette,
    input.profile.frozenStyle.materials,
    input.profile.frozenStyle.rendering,
    input.profile.frozenStyle.backgroundVocab,
    input.profile.frozenStyle.headlineZone,
    `Never: ${input.profile.frozenStyle.never}`,
    `Family: ${family.name}. ${family.skeleton}`,
    ...axisLines,
    `Headline: ${input.brief.headline}`,
    `Scene: ${input.brief.subjectScene}`,
    ...(data ? [`Data: ${data}`] : []),
    imageTextLanguageInstruction(input.contentLocale),
    `Text: ${family.textPolicy}. ${input.profile.textPolicy.legibilityLine}`,
    `Brand policy: ${input.brandBible}`,
    ...(input.operatorDirection
      ? [`Operator direction: ${input.operatorDirection}`]
      : []),
  ].join("\n");
  return {
    digest: createHash("sha256").update(prompt).digest("hex"),
    prompt,
  };
}

const CANVAS_ASPECT_TOLERANCE = 0.01;
const CANVAS_BACKDROP_BLUR_SIGMA = 40;

export async function fitToCanvas(
  original: Uint8Array,
  width: number,
  height: number,
) {
  const source = sharp(original, { failOn: "warning" });
  const metadata = await source.metadata();
  const sourceRatio = (metadata.width ?? width) / (metadata.height ?? height);
  if (Math.abs(sourceRatio / (width / height) - 1) <= CANVAS_ASPECT_TOLERANCE) {
    return source.resize(width, height, { fit: "fill" }).png().toBuffer();
  }
  const [backdrop, foreground] = await Promise.all([
    sharp(original, { failOn: "warning" })
      .resize(width, height, { fit: "cover", position: "centre" })
      .blur(CANVAS_BACKDROP_BLUR_SIGMA)
      .png()
      .toBuffer(),
    sharp(original, { failOn: "warning" })
      .resize(width, height, { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer(),
  ]);
  return sharp(backdrop)
    .composite([{ input: foreground, gravity: "centre" }])
    .png()
    .toBuffer();
}

export async function composeBrandedFinal(input: {
  logo: Uint8Array;
  original: Uint8Array;
  profile: ImageProfile;
}) {
  const { height, width } = input.profile.output;
  const shortSide = Math.min(width, height);
  const logoWidth = Math.round(
    input.profile.logo.widthShortSideRatio * shortSide,
  );
  const inset = Math.round(input.profile.logo.insetShortSideRatio * shortSide);
  const logo = await sharp(input.logo, { failOn: "warning" })
    .resize({ width: logoWidth })
    .png()
    .toBuffer();
  const logoHeight = (await sharp(logo).metadata()).height;
  const top = input.profile.logo.anchor.startsWith("top")
    ? inset
    : height - inset - logoHeight;
  const left = input.profile.logo.anchor.endsWith("left")
    ? inset
    : width - inset - logoWidth;
  if (
    top < 0 ||
    left < 0 ||
    top + logoHeight > height ||
    left + logoWidth > width
  ) {
    throw new Error("IMAGE_LOGO_GEOMETRY_INVALID");
  }
  return sharp(await fitToCanvas(input.original, width, height))
    .composite([{ input: logo, left, top }])
    .png()
    .toBuffer();
}
