export interface CompressedImage {
  dataUrl: string;
  mediaType: string;
  bytes: number;
  width: number;
  height: number;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', quality));
}

/** Shrinks a screenshot to WebP under maxBytes entirely in the browser (no storage cost). */
export async function compressImage(file: File, maxBytes = 150 * 1024): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    let quality = 0.82;
    for (let attempt = 0; attempt < 10; attempt++) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available in this browser.');
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, quality);
      if (blob && blob.size <= maxBytes) {
        return { dataUrl: await blobToDataUrl(blob), mediaType: 'image/webp', bytes: blob.size, width, height };
      }
      quality -= 0.1;
      if (quality < 0.4) {
        scale *= 0.8;
        quality = 0.7;
      }
    }
    throw new Error('Could not shrink the image under ' + Math.round(maxBytes / 1024) + ' KB.');
  } finally {
    bitmap.close();
  }
}
