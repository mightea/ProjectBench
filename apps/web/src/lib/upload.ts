const MAX_EDGE = 2560;
const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Shrinks large photos before upload to save mobile data. Anything the browser can't decode
 * (HEIC on most browsers, for example) goes up unchanged and is converted on the server.
 */
export async function prepareUpload(file: File): Promise<File> {
  if (!RESIZABLE.has(file.type) || typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = MAX_EDGE / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // PNG keeps transparency and sharp edges in screenshots; photos become JPEG.
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.88));
    if (!blob || blob.size >= file.size) return file;
    const name = type === 'image/jpeg' ? file.name.replace(/\.(jpe?g|webp)$/i, '') + '.jpg' : file.name;
    return new File([blob], name, { type });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short label for a file tile, e.g. PDF or STL. */
export function fileBadge(filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop()! : '';
  return ext.slice(0, 4).toUpperCase() || 'FILE';
}

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DATE = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const DATE_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "Today, 18:40", "Yesterday, 18:40", "Thu, 19 Nov" or "19 Nov 2025". */
export function formatTimestamp(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `Today, ${TIME.format(date)}`;
  if (days === 1) return `Yesterday, ${TIME.format(date)}`;
  return date.getFullYear() === now.getFullYear() ? DATE.format(date) : DATE_YEAR.format(date);
}
