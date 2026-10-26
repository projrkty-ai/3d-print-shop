import { t } from '../i18n';
import { TEXTURE_ACCEPTED_TYPES, TEXTURE_MAX_UPLOAD_BYTES } from '../config';

export class ImageUploadError extends Error {}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageUploadError(t("The file could not be read as an image.")));
    img.src = src;
  });
}

/**
 * Validates an uploaded image and downscales it so it fits within `maxDimension`,
 * returning a compact JPEG data URL that is safe to keep in localStorage.
 */
export async function fileToResizedDataUrl(file: File, maxDimension: number): Promise<string> {
  if (!TEXTURE_ACCEPTED_TYPES.includes(file.type)) {
    throw new ImageUploadError(t("Please upload a PNG, JPEG or WebP image."));
  }
  if (file.size > TEXTURE_MAX_UPLOAD_BYTES) {
    const limitMb = Math.round(TEXTURE_MAX_UPLOAD_BYTES / 1024 / 1024);
    throw new ImageUploadError(t("The image is too large (max {0} MB).", limitMb));
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const ratio = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * ratio));
    const height = Math.max(1, Math.round(img.naturalHeight * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageUploadError(t("Your browser cannot process images."));
    // JPEG has no alpha; flatten transparent areas onto white.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
