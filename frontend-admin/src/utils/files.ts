/** File (or other Blob) bytes (FileReader fallback for environments without Blob.arrayBuffer). */
export function readFileBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(file);
  });
}

/** Saves data in the browser's downloads under `fileName`. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked a little later: some browsers start the download only after the click handler.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
