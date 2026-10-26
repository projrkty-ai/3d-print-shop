/**
 * Splits engraving text into the lines that will actually be engraved:
 * trailing spaces are dropped, as are blank lines at the start and end.
 * Blank lines in the middle are kept so customers can add spacing.
 */
export function engravingLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end);
}

export function normalizeEngravingText(text: string): string {
  return engravingLines(text).join('\n');
}

/** Characters counted against the limit; line breaks are free. */
export function engravingCharCount(text: string): number {
  return text.replace(/\r?\n/g, '').length;
}
