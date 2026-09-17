/** Canvas raster image upload size cap. */
export const CANVAS_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const CANVAS_IMAGE_MAX_SIZE_LABEL = "10MB";

/** Returns a user-facing error message, or null if within limit. */
export function validateCanvasImageSize(
  sizeBytes: number,
  label = CANVAS_IMAGE_MAX_SIZE_LABEL
): string | null {
  if (sizeBytes > CANVAS_IMAGE_MAX_BYTES) {
    return `图片不能超过 ${label}`;
  }
  return null;
}

export function validateCanvasImageFile(file: Pick<File, "size">): string | null {
  return validateCanvasImageSize(file.size);
}
