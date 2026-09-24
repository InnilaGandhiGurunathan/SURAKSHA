/**
 * Media handling for reports.
 *
 * Photos are downscaled on the device before they are stored, because a safety
 * report must not fail on a slow link or fill the user's quota with a 6 MB photo.
 * Everything here degrades: if canvas processing is unavailable the original
 * bytes are used and the size is reported honestly.
 */

export interface CompressedImage {
  dataUrl: string;
  sizeBytes: number;
  width: number;
  height: number;
  /** True when the original had to be kept because processing was unavailable. */
  originalKept: boolean;
}

export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? '';
  return Math.round((base64.length * 3) / 4);
}

export async function compressImage(
  file: File,
  options: { maxDimension?: number; quality?: number; mimeType?: string } = {},
): Promise<CompressedImage> {
  const maxDimension = options.maxDimension ?? 1280;
  const quality = options.quality ?? 0.72;
  const mimeType = options.mimeType ?? 'image/jpeg';

  const original = await readAsDataUrl(file);

  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return {
      dataUrl: original,
      sizeBytes: file.size,
      width: 0,
      height: 0,
      originalKept: true,
    };
  }

  try {
    const image = await loadImage(original);
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');

    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL(mimeType, quality);

    if (dataUrlBytes(dataUrl) >= file.size && file.size < 900_000) {
      // Compression made it bigger (already small PNG, for example) — keep the original.
      return { dataUrl: original, sizeBytes: file.size, width: image.width, height: image.height, originalKept: true };
    }

    return { dataUrl, sizeBytes: dataUrlBytes(dataUrl), width, height, originalKept: false };
  } catch {
    return {
      dataUrl: original,
      sizeBytes: file.size,
      width: 0,
      height: 0,
      originalKept: true,
    };
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That file could not be read on this device.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be decoded.'));
    image.src = src;
  });
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Total payload weight of a set of attachments, for the storage warnings. */
export function attachmentsSize(attachments: Array<{ sizeBytes: number }>): number {
  return attachments.reduce((total, attachment) => total + attachment.sizeBytes, 0);
}
