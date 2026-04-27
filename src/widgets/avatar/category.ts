import Item from './item';

export interface PreviewInfo {
  name: string;
  path: string;
  unlock: string | undefined;
  description: string | undefined;
}

export default class Category {
  static layers: string[];

  static nonePreview: PreviewInfo =
      {name: 'None', path: 'Previews/none.png', unlock: undefined, description: undefined};

  static getLayerIndex(layerName: string) {
    return Category.layers.indexOf(layerName);
  }

  name: string;
  activeItem: Item|null = null;
  defaultItem: string|undefined;
  optional: boolean;

  private items: Map<string, Item>;
  private disabled: boolean;

  constructor(name: string, defaultItem: string, optional: boolean) {
    this.name = name;
    this.defaultItem = defaultItem;
    this.optional = optional;
    this.items = new Map<string, Item>();
    this.disabled = false;
  }

  async enable() {
    this.disabled = false;
    if (this.activeItem) {
      await this.activeItem.enable();
    }
  }

  async disable() {
    this.disabled = true;
    if (this.activeItem) {
      await this.activeItem.disable();
    }
  }

  cancel() {
    for (const item of this.items.values()) {
      item.cancel();
    }
  }

  addAvailableItem(item: Item) {
    this.items.set(item.name, item);
  }

  async chooseItem(itemName: string) {
    const item = this.items.get(itemName);
    const oldItem = this.activeItem;

    if (item === oldItem) {
      return;
    }

    if (item) {
      this.activeItem = item;
      if (!this.disabled) {
        await item.enable();
      }
    } else {
      this.activeItem = null;
    }

    if (oldItem) {
      await oldItem.disable();
    }
  }

  getFirstItemName(): string {
    return this.items.keys().next().value!;
  }

  getItemNames(): IterableIterator<string> {
    return this.items.keys();
  }

  getItem(itemName: string): Item|undefined {
    return this.items.get(itemName);
  }

  getPreviewInfo(gender: string): PreviewInfo[] {
    const previews: PreviewInfo[] = Array.from(this.items.values()).map(item => {
      const splitPath = item.path.split('/');
      splitPath.splice(0, 3);
      const previewPath = 'Previews/avatar_' + gender.toLowerCase() + '/' + splitPath.join('/') +
          '/' + Item.processFileName(item.name) + '.png';
      return {
        name: item.name,
        path: previewPath,
        unlock: item.unlock,
        description: item.description
      };
    });
    if (this.optional) {
      previews.unshift(Category.nonePreview);
    }
    return previews;
  }
}
