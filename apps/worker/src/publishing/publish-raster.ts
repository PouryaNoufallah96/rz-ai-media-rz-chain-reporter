import sharp from "sharp";

export const PUBLISH_PHOTO_JPEG_QUALITY = 85;
const JPEG_MIME_TYPE = "image/jpeg";

export async function publishRasterForUpload(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
) {
  if (mimeType === JPEG_MIME_TYPE) return { bytes, mimeType };
  if (mimeType !== "image/png" && mimeType !== "image/webp") return null;
  try {
    const encoded = await sharp(bytes, { failOn: "warning" })
      .jpeg({ quality: PUBLISH_PHOTO_JPEG_QUALITY })
      .toBuffer();
    return {
      bytes: new Uint8Array(encoded),
      mimeType: JPEG_MIME_TYPE,
    };
  } catch {
    return null;
  }
}
