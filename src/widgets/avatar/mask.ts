import Asset from './asset';
import Character from './character';
import Item from './item';

export default class Mask extends Asset {
  private layers: number[];

  constructor(item: Item, filename: string, layers: number[], character: Character) {
    super(item, filename, character);
    this.layers = layers;
  }

  get image() {
    return this.asyncImage.image;
  }

  async enable() {
    try {
      await this.load();

      for (const layer of this.layers) {
        this.character.activeMasks.add(layer, this);

        for (const asset of this.character.activeAssets.get(layer)) {
          await asset.updateMask();
        }
      }
    } catch (error) {
      console.log('ERROR:', error);
    }
  }

  async disable() {
    await this.load();

    for (const layer of this.layers) {
      this.character.activeMasks.remove(layer, this);

      for (const asset of this.character.activeAssets.get(layer)) {
        await asset.updateMask();
      }
    }
  }
}
