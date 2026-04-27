import AsyncImage from './async_image';
import Camera from './camera';
import {CanvasWrapper, ContextWrapper} from './canvas_interface';
import Character from './character';
import {AVATAR_BASE_URL} from './config';
import Mask from './mask';
import RenderOptions from './render_options';

export enum Effects {
  Glowing = 'Glowing',
  Grayscale = 'Grayscale',
  Sepia = 'Sepia',
  Silhouette = 'Silhouette',
  Rainbow = 'Rainbow',
  Pixelated = 'Pixelated',
  Ghostly = 'Ghostly',
  Radioactive = 'Radioactive',
  Negative = 'Negative',
  ColorShift = 'Color Shift'
}

export default class Renderer {
  private charCanvas: CanvasWrapper;
  private charCtx: ContextWrapper;
  private bgCanvas: CanvasWrapper;
  private bgCtx: ContextWrapper;
  private colorCanvas: CanvasWrapper;
  private colorCtx: ContextWrapper;
  private bgImg: AsyncImage;
  private bgPlatImg: AsyncImage;
  private bgOptions: RenderOptions =
      new RenderOptions(undefined, undefined, 0.36, undefined, 0.2, 1.1);
  private bgPlatOptions: RenderOptions =
      new RenderOptions(undefined, undefined, 0.36, undefined, undefined, 1.1);
  private defaultOptions: RenderOptions = new RenderOptions();
  private camera: Camera = new Camera();
  private createImage: (canvas: CanvasWrapper) => Promise<CanvasImageSource>;

  constructor(
      charCanvas: CanvasWrapper, bgCanvas: CanvasWrapper, colorCanvas: CanvasWrapper,
      createImage: (canvas: CanvasWrapper) => Promise<CanvasImageSource>) {
    this.charCanvas = charCanvas;
    this.charCtx = charCanvas.getContext('2d')!;
    this.bgCanvas = bgCanvas;
    this.bgCtx = bgCanvas.getContext('2d')!;
    this.colorCanvas = colorCanvas;
    this.colorCtx = colorCanvas.getContext('2d')!;
    this.createImage = createImage;
    this.bgImg = new AsyncImage(`${AVATAR_BASE_URL}Avatar/avatar_background.png`);
    this.bgPlatImg = new AsyncImage(`${AVATAR_BASE_URL}Avatar/avatar_platform2.png`);
  }

  private renderBG(character: Character) {
    this.bgCtx.clearRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);
    this.bgCtx.fillStyle = 'rgb(19, 7, 61)';
    this.bgCtx.fillRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);
    if (this.bgImg.image) {
      this.bgCtx.save();
      this.bgCtx.filter = `brightness(50%) blur(${this.camera.blur * window.devicePixelRatio}px)`;
      this.drawImage(this.bgCtx, this.bgImg.image, this.bgOptions);
      this.bgCtx.restore();
    } else {
      if (!this.bgImg.isLoading()) {
        this.bgImg.load().then(() => {
          if (this.bgCanvas instanceof HTMLCanvasElement) {
            this.bgCanvas.classList.toggle('loaded', true);
          }
          this.renderBG(character);
          character.needsRender = true;
        });
      }
    }

    if (this.bgPlatImg.image) {
      this.drawImage(this.bgCtx, this.bgPlatImg.image, this.bgPlatOptions);
    } else {
      if (!this.bgPlatImg.isLoading()) {
        this.bgPlatImg.load().then(() => {
          this.renderBG(character);
          character.needsRender = true;
        });
      }
    }
  }

  render(character: Character, renderBackground: boolean = true) {
    if (renderBackground) {
      this.renderBG(character);
    }

    this.charCtx.clearRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    for (const layer of character.activeAssets.sortedKeys((a, b) => a - b)) {
      if (character.disabledLayers.has(layer)) continue;
      for (const asset of character.activeAssets.get(layer)) {
        const img = asset.image;
        if (!img) continue;
        this.drawImage(this.charCtx, img, asset.item.options);
      }
    }

    this.renderEffect(character.activeEffect, character);
  }

  drawImage(
      ctx: ContextWrapper, img: CanvasImageSource, options: RenderOptions,
      ignoreCamera: boolean = false, originalResolution: boolean = false) {
    if (!img) {
      console.error('trying to draw missing image!', img);
    }

    options = RenderOptions.copyRenderOptions(options);
    const localCamera = !ignoreCamera ? this.camera : new Camera();

    const cameraScale = localCamera.scale;

    if (originalResolution) {
      options.scale = 1;
    } else {
      const imgToCanvasYRatio = <number>img.height / ctx.canvas.height;
      options.scale /= imgToCanvasYRatio;
    }

    const imgScaleFactor = options.scale * (1 + (cameraScale - 1) * options.cameraScaleMult);
    const canvasImgWidth = <number>img.width * imgScaleFactor;
    const canvasImgHeight = <number>img.height * imgScaleFactor;

    options.centerX += localCamera.offsetX * options.cameraScaleMult;
    options.centerY += localCamera.offsetY * options.cameraScaleMult;

    const goalRatio = 1920 / 1080;
    const canvasRatio = ctx.canvas.width / ctx.canvas.height;
    options.centerX = (options.centerX - 0.5) * cameraScale / canvasRatio * goalRatio + 0.5;

    ctx.drawImage(
        img, options.centerX * ctx.canvas.width - canvasImgWidth * options.imgCenterX,
        options.centerY * ctx.canvas.height - canvasImgHeight * options.imgCenterY, canvasImgWidth,
        canvasImgHeight);
  }

  private easeInOut(t: number, b: number, c: number, d: number): number {
    t = Math.min(t, d);
    t /= d / 2;
    if (t < 1) return c / 2 * t * t + b;
    t--;
    return -c / 2 * (t * (t - 2) - 1) + b;
  }

  zoomSection(sectionName: string, categoryName: string, character: Character) {
    const duration = 0.5;
    const startT = Date.now();

    const origCamera = Camera.copyCamera(this.camera);
    const futureCamera = Camera.copyCamera(this.camera);

    if (sectionName === 'head') {
      futureCamera.scale = 2;
      futureCamera.offsetX = 0;
      futureCamera.offsetY = character.getHeadHeight();
      futureCamera.blur = 5;
    } else if (categoryName === 'pet') {
      futureCamera.scale = 1.2;
      futureCamera.offsetX = 0.2;
      futureCamera.offsetY = -0.15;
      futureCamera.blur = 5;
    } else {
      futureCamera.scale = 1;
      futureCamera.offsetX = 0;
      futureCamera.offsetY = 0;
      futureCamera.blur = 1.5;
    }

    const animate = () => {
      const x = Math.min(1, (Date.now() - startT) / (duration * 1000));

      const ease = (from: number, to: number) => {
        return this.easeInOut(Date.now() - startT, from, to - from, duration * 1000);
      };
      this.camera.scale = ease(origCamera.scale, futureCamera.scale);
      this.camera.offsetX = ease(origCamera.offsetX, futureCamera.offsetX);
      this.camera.offsetY = ease(origCamera.offsetY, futureCamera.offsetY);
      this.camera.blur = ease(origCamera.blur, futureCamera.blur);

      character.needsRender = true;

      if (x < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  async drawMask(img: CanvasImageSource, masksForLayer: Mask[]): Promise<CanvasImageSource> {
    const oldWidth = this.colorCanvas.width;
    const oldHeight = this.colorCanvas.height;
    this.colorCanvas.width = <number>img.width;
    this.colorCanvas.height = <number>img.height;
    this.colorCtx.save();
    this.colorCtx.clearRect(0, 0, <number>img.width, <number>img.height);
    this.drawImage(this.colorCtx, img, this.defaultOptions, true, true);

    this.colorCtx.globalCompositeOperation = 'destination-out';
    for (const mask of masksForLayer) {
      const maskImg = mask.image;
      if (!maskImg) continue;
      this.drawImage(this.colorCtx, maskImg, this.defaultOptions, true, true);
    }

    this.colorCtx.restore();

    const maskedImage = await this.createImage(this.colorCanvas);
    this.colorCanvas.width = oldWidth;
    this.colorCanvas.height = oldHeight;
    return maskedImage;
  }

  async colorizeImage(img: CanvasImageSource, hexColor: string): Promise<CanvasImageSource> {
    const imgWidth = <number>img.width;
    const imgHeight = <number>img.height;
    const oldWidth = this.colorCanvas.width;
    const oldHeight = this.colorCanvas.height;
    this.colorCanvas.width = imgWidth;
    this.colorCanvas.height = imgHeight;
    this.colorCtx.save();
    this.colorCtx.clearRect(0, 0, imgWidth, imgHeight);
    this.drawImage(this.colorCtx, img, this.defaultOptions, true, true);

    const imageData = this.colorCtx.getImageData(0, 0, imgWidth, imgHeight);
    const pixels = imageData.data;
    const len = imgWidth * imgHeight * 4;
    const color = this.getRGBColor(hexColor);
    for (let i = 0; i < len; i += 4) {
      pixels[i + 0] = pixels[i + 0] * color[0] / 255;
      pixels[i + 1] = pixels[i + 1] * color[1] / 255;
      pixels[i + 2] = pixels[i + 2] * color[2] / 255;
      pixels[i + 3] = pixels[i + 3] * color[3] / 255;
    }
    this.colorCtx.putImageData(imageData, 0, 0);

    this.colorCtx.restore();

    const coloredImage = await this.createImage(this.colorCanvas);

    this.colorCanvas.width = oldWidth;
    this.colorCanvas.height = oldHeight;
    return coloredImage;
  }

  private getRGBColor(hexColor: string): number[] {
    hexColor = hexColor.substring(1);
    const colorRGB: number[] = [];
    const hexDigits = hexColor.length / 2;
    for (let i = 0; i < hexDigits; i++) {
      colorRGB.push(parseInt(hexColor.substring(i * 2, (i + 1) * 2), 16));
    }
    if (hexDigits < 4) {
      colorRGB.push(255);
    }
    return colorRGB;
  }

  applyFilter(effect: string) {
    this.charCtx.filter = 'none';

    switch (effect) {
      case Effects.Negative:
        this.filterNegative();
        break;
      case Effects.Ghostly:
        this.filterLowContrast();
        this.filterTranslucent();
        break;
      case Effects.Radioactive:
        this.filterLowContrast();
        break;
      case Effects.Grayscale:
        this.filterGrayscale();
        break;
      case Effects.Sepia:
        this.filterSepia();
        break;
      case Effects.Silhouette:
        this.filterSilhouette();
        break;
    }
  }

  private renderEffect(effect: string, character: Character) {
    switch (effect) {
      case Effects.ColorShift:
        this.effectHueShift(character);
        break;
      case Effects.Negative:
        this.effectGlowPulse('white', character);
        break;
      case Effects.Ghostly:
        this.effectGhostly(character);
        break;
      case Effects.Radioactive:
        this.effectRadioactive(character);
        break;
      case Effects.Glowing:
        this.effectLuminous();
        break;
      case Effects.Silhouette:
        this.effectSilhouette();
        break;
      case Effects.Pixelated:
        this.effectPixelated();
        break;
      case Effects.Rainbow:
        this.effectRainbowTint();
        break;
    }
  }

  private addFilter(filter: string) {
    if (this.charCtx.filter === 'none') {
      this.charCtx.filter = filter;
    } else {
      this.charCtx.filter += ' ' + filter;
    }
  }

  private effectTint(color: string) {
    this.colorCtx.save();
    this.colorCtx.clearRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    this.colorCtx.drawImage(<CanvasImageSource>this.charCanvas, 0, 0);
    this.colorCtx.globalCompositeOperation = 'hue';
    this.colorCtx.fillStyle = color;
    this.colorCtx.fillRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    this.colorCtx.globalCompositeOperation = 'destination-in';
    this.colorCtx.drawImage(<CanvasImageSource>this.charCanvas, 0, 0);
    this.colorCtx.restore();
    this.charCtx.clearRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    this.charCtx.drawImage(<CanvasImageSource>this.colorCanvas, 0, 0);
  }

  private effectRainbowTint() {
    this.colorCtx.save();
    this.colorCtx.clearRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    this.colorCtx.drawImage(<CanvasImageSource>this.charCanvas, 0, 0);
    this.colorCtx.globalCompositeOperation = 'hue';
    const grad = this.colorCtx.createLinearGradient(
        this.charCanvas.width / 2, 0.3 * this.charCanvas.height, this.charCanvas.width / 2,
        0.9 * this.charCanvas.height);
    const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'purple'];
    for (let i = 0; i < colors.length; i++) {
      grad.addColorStop(i / (colors.length - 1), colors[i]);
    }
    this.colorCtx.fillStyle = grad;
    this.colorCtx.fillRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    this.colorCtx.globalCompositeOperation = 'destination-in';
    this.colorCtx.drawImage(<CanvasImageSource>this.charCanvas, 0, 0);
    this.colorCtx.restore();
    this.charCtx.clearRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    this.charCtx.drawImage(<CanvasImageSource>this.colorCanvas, 0, 0);
  }

  private filterInvert() {
    this.addFilter('invert(100%)');
  }

  private filterGrayscale() {
    this.addFilter('grayscale(100%)');
  }

  private filterSepia() {
    this.addFilter('grayscale(100%)');
    this.addFilter('brightness(90%)');
    this.addFilter('sepia(100%)');
  }

  private filterSilhouette() {
    this.addFilter('brightness(0%)');
  }

  private effectSilhouette() {
    this.effectGlow('black', 20);
  }

  private effectGlowPulse(color: string, character: Character) {
    const intensity = Math.sin(new Date().getTime() / 400) * 5 + 15;
    this.effectGlow(color, intensity);
    character.needsRender = true;
  }

  private effectGlow(color: string, intensity: number) {
    const oldColorFilter = this.colorCtx.filter;
    this.colorCtx.filter = this.charCtx.filter;
    this.colorCtx.clearRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    this.colorCtx.drawImage(<CanvasImageSource>this.charCanvas, 0, 0);
    this.colorCtx.filter = oldColorFilter;
    this.charCtx.save();
    this.charCtx.shadowColor = color;
    this.charCtx.shadowBlur = intensity;
    this.charCtx.clearRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    this.charCtx.drawImage(<CanvasImageSource>this.colorCanvas, 0, 0);
    this.charCtx.restore();
  }

  private effectLuminous() {
    const oldColorFilter = this.colorCtx.filter;
    this.colorCtx.filter = this.charCtx.filter;
    this.colorCtx.clearRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    this.colorCtx.drawImage(<CanvasImageSource>this.charCanvas, 0, 0);
    this.colorCtx.filter = oldColorFilter;
    this.charCtx.save();
    this.charCtx.filter = 'blur(10px)';
    this.charCtx.clearRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    this.charCtx.drawImage(<CanvasImageSource>this.colorCanvas, 0, 0);
    this.charCtx.filter = 'none';
    this.charCtx.drawImage(<CanvasImageSource>this.colorCanvas, 0, 0);
    this.charCtx.restore();
  }

  private filterNegative() {
    this.filterInvert();
    this.filterGrayscale();
  }

  private filterTranslucent() {
    this.addFilter('opacity(90%)');
  }

  private filterLowContrast() {
    this.addFilter('contrast(90%)');
  }

  private effectGhostly(character: Character) {
    this.effectGlowPulse('DodgerBlue', character);
    this.effectTint('DodgerBlue');
  }

  private effectRadioactive(character: Character) {
    this.effectGlowPulse('Lime', character);
    this.effectTint('Lime');
  }

  private effectHueShift(character: Character) {
    const deg = Math.floor(new Date().getTime() / 5) % 360;
    this.charCtx.filter = 'hue-rotate(' + deg + 'deg)';
    const glowColor = 'hsl(' + deg + ', 70%, 50%)';
    this.effectGlow(glowColor, 10);
    character.needsRender = true;
  }

  private effectPixelated() {
    const oldColorFilter = this.colorCtx.filter;
    this.colorCtx.filter = this.charCtx.filter;
    this.colorCtx.clearRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    const pixelation = 4;
    this.colorCanvas.width = this.charCanvas.width / pixelation;
    this.colorCanvas.height = this.charCanvas.height / pixelation;
    this.colorCtx.drawImage(
        <CanvasImageSource>this.charCanvas, 0, 0, this.colorCanvas.width, this.colorCanvas.height);
    this.colorCtx.filter = oldColorFilter;

    this.charCtx.save();
    this.charCtx.imageSmoothingEnabled = false;
    this.charCtx.clearRect(0, 0, this.charCanvas.width, this.charCanvas.height);
    this.charCtx.drawImage(
        <CanvasImageSource>this.colorCanvas, 0, 0, this.charCanvas.width, this.charCanvas.height);
    this.charCtx.restore();

    this.colorCanvas.width = this.charCanvas.width;
    this.colorCanvas.height = this.charCanvas.height;
  }
}
