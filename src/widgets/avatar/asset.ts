import AsyncImage from './async_image';
import Character from './character';
import Item from './item';

export default class Asset {
  item: Item;
  protected asyncImage: AsyncImage;
  protected character: Character;
  private loadPromise: Promise<any> | undefined;

  constructor(item: Item, filename: string, character: Character) {
    this.item = item;
    this.character = character;

    this.asyncImage = new AsyncImage(`${this.item.path}/${filename}.png`);
  }

  cancel() {
    this.asyncImage.cancel();
  }

  load() {
    if (!this.loadPromise) {
      this.loadPromise = this.asyncImage.load();
    }

    return this.loadPromise;
  }
}
