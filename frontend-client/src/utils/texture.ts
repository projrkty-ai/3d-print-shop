import { resolveAssetUrl } from '../api/urls';
import type { AppearanceSummary, Product, SurfaceCustomization } from '../types';
import { textureOption } from './customization';

/** Image to emboss on the preview: the chosen shop texture (from the API host) or the customer's own picture. */
export function appliedTextureUrl(product: Product, choices: SurfaceCustomization): string | null {
  const option = textureOption(product, choices.textureId);
  return option ? resolveAssetUrl(option.url) : choices.textureDataUrl;
}

/** Texture image of an ordered appearance: the snapshotted shop texture, or the uploaded picture. */
export function orderedTextureUrl(appearance: AppearanceSummary, choices: SurfaceCustomization): string | null {
  return appearance.texture?.source === 'library' ? resolveAssetUrl(appearance.texture.url) : choices.textureDataUrl;
}
