/**
 * Player screenshots were stored as full size PNGs, 1.5 to 3.5 MB each
 * (Ames 2026-10-07: "let's also save them as compressed"). A screenshot is
 * for a helper to look at, so it is saved as WebP (JPEG where a browser
 * cannot write WebP), no larger than 2560 px on its long side.
 *
 * Never worse than the original: if the picture cannot be read, or the
 * result is not smaller, the original goes up unchanged.
 */
const MAX_SIDE = 2560;
const QUALITY = 0.85;

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise(resolve => {
    try { canvas.toBlob(b => resolve(b && b.type === type ? b : null), type, QUALITY); } catch { resolve(null); }
  });
}

export async function compressScreenshot(blob: Blob): Promise<Blob> {
  try {
    if (!/^image\/(png|jpeg|webp)$/.test(blob.type)) return blob;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    // A see-through PNG would turn black as a JPEG: lay it on the viewer's dark.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const out = (await encode(canvas, 'image/webp')) ?? (await encode(canvas, 'image/jpeg'));
    return out && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}
