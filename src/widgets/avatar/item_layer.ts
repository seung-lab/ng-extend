import Asset from './asset';
import Character from './character';
import Item from './item';

export default class ItemLayer extends Asset {
  public colorable: boolean;
  public layer: number;
  private coloredImage: CanvasImageSource|null;
  private maskedImage: CanvasImageSource|null;
  private enabled: boolean = false;

  constructor(item: Item, filename: string, layer: number, colorable: boolean, character: Character) {
    super(item, filename, character);
    this.layer = layer;
    this.colorable = colorable;
    this.coloredImage = null;
    this.maskedImage = null;
  }

  async enable() {
    this.enabled = true;
    await this.load();
    this.character.activeAssets.add(this.layer, this);
    await this.refreshColor();
  }

  async refreshColor() {
    if (this.item.color) {
      if (!this.item.useLayerColors || this.colorable) {
        await this.setColor(this.item.color);
      }
    }
    await this.updateMask();
  }

  async disable() {
    this.enabled = false;
    await this.load();
    this.character.activeAssets.remove(this.layer, this);
  }

  get image() {
    return this.maskedImage || this.getColoredImage();
  }

  private getColoredImage() {
    return this.coloredImage || this.asyncImage.image;
  }

  async updateMask() {
    this.character.itemRenderQueue.add(this.updateMaskQueued.bind(this));
    await this.character.itemRenderQueue.wait();
  }

  async updateMaskQueued() {
    const masksForLayer = this.character.activeMasks.get(this.layer);

    if (masksForLayer.length === 0 && !this.maskedImage) {
      return;
    }

    const colored = this.getColoredImage();
    if (!colored) return;
    this.maskedImage =
        await this.character.renderer.drawMask(colored, masksForLayer);
  }

  async setColor(color: string) {
    if (this.enabled) {
      this.character.itemRenderQueue.add(() => {
        return this.setColorQueued(color);
      });
      await this.character.itemRenderQueue.wait();
    }
  }

  async setColorQueued(color: string) {
    const img = this.asyncImage.image;
    if (!img) return;
    this.coloredImage = await this.character.renderer.colorizeImage(img, color);
  }
}
