/**
 * A small animated GIF writer for photo mode (Nseraf, report 246: the
 * recording should come in a format the forum takes). Frames arrive as RGBA;
 * one 256 colour palette is chosen from the first frame and every frame is
 * matched to it, which suits cells on a plain background. LZW as in the GIF89a
 * spec, code size switching as omggif does it.
 */

/** RGB at 5 bits a channel: 32768 bins. */
const bin = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

export class GifWriter {
  private parts: Uint8Array[] = [];
  private palette = new Uint8Array(768);
  private paletteSize = 0;
  /** Bin to palette index, filled as bins turn up. */
  private lookup = new Int16Array(32768).fill(-1);
  private started = false;

  constructor(private width: number, private height: number) {}

  /** Add one frame (RGBA, width x height) shown for `delayCs` hundredths of a second. */
  addFrame(rgba: Uint8ClampedArray, delayCs: number) {
    if (!this.started) { this.choosePalette(rgba); this.writeHeader(); this.started = true; }
    const n = this.width * this.height;
    const idx = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) idx[i] = this.nearest(bin(rgba[p], rgba[p + 1], rgba[p + 2]));
    const d = Math.max(2, Math.round(delayCs));
    // Graphic control: leave the frame in place, no transparency.
    this.push([0x21, 0xf9, 4, 0x04, d & 255, d >> 8, 0, 0]);
    this.push([0x2c, 0, 0, 0, 0, this.width & 255, this.width >> 8, this.height & 255, this.height >> 8, 0]);
    this.parts.push(lzw(idx));
  }

  finish(): Blob {
    this.push([0x3b]);
    return new Blob(this.parts as BlobPart[], { type: 'image/gif' });
  }

  private push(bytes: number[]) { this.parts.push(Uint8Array.from(bytes)); }

  private writeHeader() {
    const w = this.width, h = this.height;
    this.push([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 255, w >> 8, h & 255, h >> 8, 0xf7, 0, 0]);
    this.parts.push(this.palette);
    // Loop forever.
    this.push([0x21, 0xff, 11, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 3, 1, 0, 0, 0]);
  }

  /** The 256 most common colours of the first frame. */
  private choosePalette(rgba: Uint8ClampedArray) {
    const count = new Uint32Array(32768);
    const sum = new Float64Array(32768 * 3);
    for (let p = 0; p < rgba.length; p += 4) {
      const b = bin(rgba[p], rgba[p + 1], rgba[p + 2]);
      count[b]++;
      sum[b * 3] += rgba[p]; sum[b * 3 + 1] += rgba[p + 1]; sum[b * 3 + 2] += rgba[p + 2];
    }
    const used: number[] = [];
    for (let b = 0; b < 32768; b++) if (count[b]) used.push(b);
    used.sort((a, b) => count[b] - count[a]);
    const top = used.slice(0, 256);
    top.forEach((b, i) => {
      for (let c = 0; c < 3; c++) this.palette[i * 3 + c] = Math.round(sum[b * 3 + c] / count[b]);
      this.lookup[b] = i;
    });
    this.paletteSize = Math.max(1, top.length);
  }

  private nearest(b: number): number {
    const hit = this.lookup[b];
    if (hit >= 0) return hit;
    const r = ((b >> 10) << 3) + 4, g = (((b >> 5) & 31) << 3) + 4, bl = ((b & 31) << 3) + 4;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.paletteSize; i++) {
      const dr = this.palette[i * 3] - r, dg = this.palette[i * 3 + 1] - g, db = this.palette[i * 3 + 2] - bl;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    this.lookup[b] = best;
    return best;
  }
}

// The code table, shared by every frame: key prefix*256+k, and the stamp says
// which generation wrote an entry, so a new table costs nothing.
const codes = new Int16Array(4096 * 256);
const stamp = new Int32Array(4096 * 256);
let gen = 0;

/** One frame's palette indices as GIF LZW data in sub-blocks (min code size 8). */
function lzw(idx: Uint8Array): Uint8Array {
  const MIN = 8, CLEAR = 256, EOI = 257;
  const out: number[] = [MIN];
  let block: number[] = [];
  const byte = (v: number) => { block.push(v); if (block.length === 255) { out.push(255, ...block); block = []; } };
  gen++;
  let size = MIN + 1, next = EOI + 1;
  let cur = 0, shift = 0;
  const emit = (code: number) => {
    cur |= code << shift; shift += size;
    while (shift >= 8) { byte(cur & 255); cur >>>= 8; shift -= 8; }
  };
  emit(CLEAR);
  if (!idx.length) { emit(EOI); if (shift > 0) byte(cur & 255); if (block.length) out.push(block.length, ...block); out.push(0); return Uint8Array.from(out); }
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i];
    const key = prefix * 256 + k;
    if (stamp[key] === gen) { prefix = codes[key]; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(CLEAR);
      gen++; size = MIN + 1; next = EOI + 1;
    } else {
      if (next >= (1 << size)) size++;
      codes[key] = next++; stamp[key] = gen;
    }
    prefix = k;
  }
  emit(prefix);
  emit(EOI);
  if (shift > 0) byte(cur & 255);
  if (block.length) out.push(block.length, ...block);
  out.push(0);
  return Uint8Array.from(out);
}
