export interface FilePart {
  key: string;
  name: string;
  /** #rrggbb (sRGB). */
  color: string;
}

export const MAX_FILE_PARTS = 8;
export const PART_ATTRIBUTE = 'partIndex';
