import { z } from "zod";

import {
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_DIMENSION,
  MAX_REFERENCE_IMAGE_PIXELS,
  REFERENCE_IMAGE_MIME_TYPES,
} from "./media";

export type ImageAspectRatio = `${number}:${number}`;

export type OrderedReferenceCapability = {
  aspectRatios: readonly ImageAspectRatio[];
  maxOrderedReferences: number;
  maxTotalReferenceBytes: number;
  reference: {
    maxBytes: number;
    maxDimension: number;
    maxPixels: number;
    mimeTypes: readonly (typeof REFERENCE_IMAGE_MIME_TYPES)[number][];
  };
};

const orderedReferenceCapability = {
  maxOrderedReferences: 2,
  maxTotalReferenceBytes: MAX_REFERENCE_IMAGE_BYTES * 2,
  reference: {
    maxBytes: MAX_REFERENCE_IMAGE_BYTES,
    maxDimension: MAX_REFERENCE_IMAGE_DIMENSION,
    maxPixels: MAX_REFERENCE_IMAGE_PIXELS,
    mimeTypes: REFERENCE_IMAGE_MIME_TYPES,
  },
} as const satisfies Omit<OrderedReferenceCapability, "aspectRatios">;

const wideAspectRatios: readonly ImageAspectRatio[] = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "21:9",
];

const narrowAspectRatios: readonly ImageAspectRatio[] = [
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
];

export const IMAGE_OPTION_CAPABILITY_KEYS = [
  "gemini-flash-image",
  "gemini-pro-image",
  "gpt-image",
  "recraft-v4-pro",
  "standard-image",
] as const;

export const imageOptionCapabilityKeySchema = z.enum(
  IMAGE_OPTION_CAPABILITY_KEYS,
);

export type ImageOptionCapabilityKey = z.infer<
  typeof imageOptionCapabilityKeySchema
>;

export const IMAGE_OPTION_CAPABILITIES = {
  "gemini-flash-image": {
    ...orderedReferenceCapability,
    aspectRatios: wideAspectRatios,
  },
  "gemini-pro-image": {
    ...orderedReferenceCapability,
    aspectRatios: wideAspectRatios,
  },
  "gpt-image": {
    ...orderedReferenceCapability,
    aspectRatios: wideAspectRatios,
  },
  "recraft-v4-pro": {
    ...orderedReferenceCapability,
    aspectRatios: narrowAspectRatios,
  },
  "standard-image": {
    ...orderedReferenceCapability,
    aspectRatios: narrowAspectRatios,
  },
} as const satisfies Record<
  ImageOptionCapabilityKey,
  OrderedReferenceCapability
>;

export function closestSupportedAspectRatio(
  optionKey: ImageOptionCapabilityKey,
  output: { height: number; width: number },
): ImageAspectRatio {
  const target = Math.log(output.width / output.height);
  const [closest] = [...IMAGE_OPTION_CAPABILITIES[optionKey].aspectRatios]
    .map((ratio) => {
      const [width, height] = ratio.split(":").map(Number);
      return {
        distance: Math.abs(Math.log((width ?? 1) / (height ?? 1)) - target),
        ratio,
      };
    })
    .sort((left, right) => left.distance - right.distance);
  if (!closest) throw new Error("IMAGE_ASPECT_RATIO_UNSUPPORTED");
  return closest.ratio;
}
