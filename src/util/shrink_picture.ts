/**
 * Blog pictures may be at most 3 MB (the upload server's limit), and a photo
 * from a phone is often more (Ames 2026-11-05, galleries). A picture over the
 * limit, or wider than the blog could ever show, is made smaller here before
 * it is uploaded, instead of being refused.
 *
 * Saved as WebP, which keeps a diagram's see-through background (JPEG, on a
 * white background, only where a browser cannot write WebP). A GIF is left
 * alone, since redrawing it would stop it moving. Never worse than the
 * original: if the picture cannot be read, the original goes up unchanged.
 */
const LIMIT = 3 * 1024 * 1024;
const MAX_SIDE = 2560;

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => {
    try { canvas.toBlob(b => resolve(b && b.type === type ? b : null), type, quality); } catch { resolve(null); }
  });
}

export async function shrinkPicture(file: File): Promise<File> {
  try {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
    const bitmap = await createImageBitmap(file);
    const long = Math.max(bitmap.width, bitmap.height);
    if (file.size <= LIMIT && long <= MAX_SIDE) { bitmap.close?.(); return file; }
    let side = Math.min(long, MAX_SIDE);
    let best: Blob | null = null;
    for (let tries = 0; tries < 6; tries++) {
      const scale = side / long;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let out = await encode(canvas, 'image/webp', 0.88);
      if (!out) {
        ctx.globalCompositeOperation = 'destination-over';   // white behind anything see-through
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        out = await encode(canvas, 'image/jpeg', 0.88);
      }
      if (!out) break;
      best = out;
      if (out.size <= LIMIT) break;
      side = Math.round(side * 0.75);
    }
    bitmap.close?.();
    if (!best || best.size >= file.size) return file;
    const ext = best.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([best], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type: best.type });
  } catch {
    return file;
  }
}
