export default class Camera {
  scale: number;
  offsetX: number;
  offsetY: number;
  blur: number;

  constructor(scale: number = 1, offsetX: number = 0, offsetY: number = 0, blur: number = 1.5) {
    this.scale = scale;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.blur = blur;
  }

  static copyCamera(camera: Camera): Camera {
    return new Camera(camera.scale, camera.offsetX, camera.offsetY, camera.blur);
  }
}
