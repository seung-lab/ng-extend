export default class RenderOptions {
  centerX: number;
  centerY: number;
  imgCenterX: number;
  imgCenterY: number;
  cameraScaleMult: number;
  scale: number;

  constructor(
      centerX: number = 0.5, centerY: number = 0.5, imgCenterX: number = 0.5,
      imgCenterY: number = 0.5, cameraScaleMult: number = 1, scale: number = 1) {
    this.centerX = centerX;
    this.centerY = centerY;
    this.imgCenterX = imgCenterX;
    this.imgCenterY = imgCenterY;
    this.cameraScaleMult = cameraScaleMult;
    this.scale = scale;
  }

  static copyRenderOptions(ro: RenderOptions): RenderOptions {
    return new RenderOptions(
        ro.centerX, ro.centerY, ro.imgCenterX, ro.imgCenterY, ro.cameraScaleMult, ro.scale);
  }
}
