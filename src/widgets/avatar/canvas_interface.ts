export interface CanvasWrapper {
  width: number;
  height: number;

  getContext(contextId: '2d', options?: CanvasRenderingContext2DSettings|undefined): ContextWrapper
      |null;
}

export interface ContextWrapper {
  canvas: CanvasWrapper;
  filter: string;
  fillStyle: string|CanvasGradient|CanvasPattern;
  globalCompositeOperation: string;
  shadowBlur: number;
  shadowColor: string;
  imageSmoothingEnabled: boolean;

  clearRect(x: number, y: number, w: number, h: number): void;

  drawImage(image: CanvasImageSource, sx: number, sy: number): void;

  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;

  fillRect(x: number, y: number, w: number, h: number): void;

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;

  save(): void;

  restore(): void;

  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;

  putImageData(imagedata: ImageData, dx: number, dy: number): void;
}
