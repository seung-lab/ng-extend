export interface FxMeta { size: [number, number]; origin: [number, number]; duration: number; loop: boolean }
export interface FxModule { meta: FxMeta }
export interface FxFrame { w: number; h: number }
export interface FxInstance {
  update(dt: number): void;
  draw(frame: FxFrame, layer?: 'back' | 'front'): void;
  stop(): void;
  done(): boolean;
}
export function createFrame(w: number, h: number, ox?: number, oy?: number): FxFrame;
export function clearFrame(f: FxFrame): FxFrame;
export function createFx(mod: FxModule, o?: Record<string, unknown>): FxInstance;
export function composite(f: FxFrame, out: Uint8ClampedArray, bg?: number | Uint32Array | null, lightK?: number): void;
export const collectBurst: FxModule;
export const gemSpin: FxModule;
export const lootBeam: FxModule;
export const poof: FxModule;
export const fireworkBurst: FxModule;
