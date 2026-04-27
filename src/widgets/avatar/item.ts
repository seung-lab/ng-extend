import Category from './category';
import Character from './character';
import ItemLayer from './item_layer';
import Mask from './mask';
import RenderOptions from './render_options';

export interface Variant {
  file: string;
  color: string;
}

export default class Item {
  name: string = '';
  disables: string[] = [];
  modifiers: string[] = [];
  options: RenderOptions;
  path: string;
  colors: string[]|undefined;
  defaultColor: number = 0;
  variants: Variant[]|undefined;
  unlock: string|undefined;
  description: string|undefined;
  useLayerColors: boolean = false;
  showInfo: boolean = true;
  private activeColor: string|null = null;
  private activeVariant: number|null = null;
  private variantAssetIndex: number = 0;
  private assets: ItemLayer[];
  private masks: Mask[];
  private modifiedAssets: Map<string, ItemLayer[]>;
  private modifiedMasks: Map<string, Mask[]>;
  private currentAssets: ItemLayer[] = [];
  private currentMasks: Mask[] = [];
  private variantAssets: ItemLayer[] = [];
  private character: Character;
  private category: Category;

  static processFileName(fileName: string): string {
    return fileName.toLowerCase().replace(new RegExp(' ', 'g'), '_').replace(new RegExp('\'', 'g'), '');
  }

  constructor(
      itemJSON: any, categoryJSON: any, path: string, category: Category, character: Character) {
    this.path = path;
    this.category = category;
    this.character = character;

    if (Array.isArray(itemJSON) || typeof itemJSON === 'string') {
      itemJSON = {assets: itemJSON};
    }

    itemJSON.assets = this.makeArray(itemJSON.assets);

    if (typeof itemJSON.assets[0] === 'string') {
      this.name = itemJSON.assets[0];
      itemJSON.assets[0] = {file: this.name, layer: categoryJSON.name};
    } else {
      this.name = itemJSON.assets[0].file;
    }

    for (const asset of itemJSON.assets) {
      asset.file = Item.processFileName(asset.file);
      asset.layer = Category.getLayerIndex(asset.layer);
      asset.colorable = !!asset.colorable;
    }

    this.assets =
        itemJSON.assets
            .filter((assetJSON: any) => {
              return (!assetJSON.requiresModifier) || (assetJSON.requiresModifier.includes(''));
            })
            .map(
                (assetJSON: any) =>
                    new ItemLayer(this, assetJSON.file, assetJSON.layer, assetJSON.colorable, character));

    const masksJSON = Item.getProperty('masks', itemJSON, categoryJSON, []);
    for (const mask of masksJSON) {
      mask.layers = this.makeArray(mask.layer).map((layer: string) => Category.getLayerIndex(layer));
    }
    this.masks = masksJSON.map((maskJSON: any) => {
      const maskFile = this.getIfHasProperty(maskJSON, 'file', itemJSON.assets[0].file + '-mask');
      return new Mask(this, maskFile, maskJSON.layers, character);
    });

    this.useLayerColors = false;
    for (const layer of this.assets) {
      if (layer.colorable) {
        this.useLayerColors = true;
        break;
      }
    }

    this.colors = Item.getProperty(this.useLayerColors ? 'layerColors' : 'colors', itemJSON, categoryJSON, undefined);
    if (this.colors) {
      this.defaultColor = Item.getProperty(this.useLayerColors ? 'defaultLayerColor' : 'defaultColor', itemJSON, categoryJSON, 0);
      this.activeColor = this.colors[this.defaultColor];
    } else {
      this.activeColor = null;
    }

    this.unlock = Item.getProperty('unlock', itemJSON, categoryJSON, undefined);
    this.description = Item.getProperty('description', itemJSON, categoryJSON, undefined);
    this.showInfo = Item.getProperty('showInfo', itemJSON, categoryJSON, true);

    const options = Item.getProperty('options', itemJSON, categoryJSON, {});
    this.options = new RenderOptions(
        options.centerX, options.centerY, options.imgCenterX, options.imgCenterY,
        options.cameraScaleMult, options.scale);

    this.variants = Item.getProperty('variants', itemJSON, categoryJSON, undefined);
    if (this.variants) {
      const variantLayerName = Item.getProperty('variantLayer', itemJSON, categoryJSON, undefined);
      const variantLayer = Category.getLayerIndex(variantLayerName);
      for (let i = 0; i < this.assets.length; i++) {
        if (this.assets[i].layer === variantLayer) {
          this.variantAssetIndex = i;
          break;
        }
      }
      this.variantAssets = this.variants.map(variant => new ItemLayer(this, variant.file, variantLayer, false, character));
      this.activeVariant = 0;
    } else {
      this.activeVariant = null;
    }

    this.disables = Item.getProperty('disables', itemJSON, categoryJSON, []);
    this.modifiers = Item.getProperty('modifiers', itemJSON, categoryJSON, []);

    const modifiedBy = Item.getProperty('modifiedBy', itemJSON, categoryJSON, []);
    const modifiersAffectMask =
        Item.getProperty('modifiersAffectMask', itemJSON, categoryJSON, false);
    this.modifiedAssets = new Map<string, ItemLayer[]>();
    this.modifiedMasks = new Map<string, Mask[]>();
    for (const modifierInfo of modifiedBy) {
      const modifiedAsset =
          itemJSON.assets
              .filter((assetJSON: any) => {
                return (!assetJSON.requiresModifier) ||
                    (assetJSON.requiresModifier.includes(modifierInfo.modifier));
              })
              .map((assetJSON: any) => {
                let filename = assetJSON.file;
                const currentLayer = Category.layers[assetJSON.layer];
                if ((!modifierInfo.appliesTo || modifierInfo.appliesTo.includes(currentLayer)) && (assetJSON.modifiersAffectLayer !== false)) {
                  filename += modifierInfo.suffix;
                }
                return new ItemLayer(this, filename, assetJSON.layer, assetJSON.colorable, character);
              });
      this.modifiedAssets.set(modifierInfo.modifier, modifiedAsset);

      const modifiedMask = masksJSON.map((maskJSON: any) => {
        let maskFile = this.getIfHasProperty(maskJSON, 'file', itemJSON.assets[0].file + '-mask');
        if (modifiersAffectMask) {
          maskFile += modifierInfo.suffix;
        }
        return new Mask(this, maskFile, maskJSON.layers, character);
      });
      this.modifiedMasks.set(modifierInfo.modifier, modifiedMask);
    }

    this.updateCurrentAssets();
  }

  private makeArray(x: any) {
    return Array.isArray(x) ? x : [x];
  }

  static getProperty(propName: string, itemJSON: any, categoryJSON: any, defaultValue: any) {
    if (itemJSON.hasOwnProperty(propName)) {
      return itemJSON[propName];
    } else if (categoryJSON.hasOwnProperty(propName)) {
      return categoryJSON[propName];
    } else {
      return defaultValue;
    }
  }

  private getIfHasProperty(obj: any, propName: string, defaultValue: any) {
    if (obj.hasOwnProperty(propName)) {
      return obj[propName];
    } else {
      return defaultValue;
    }
  }

  cancel() {
    for (const asset of this.assets) {
      asset.cancel();
    }

    for (const assets of Object.values(this.modifiedAssets)) {
      for (const asset of assets) {
        asset.cancel();
      }
    }

    for (const mask of this.masks) {
      mask.cancel();
    }

    for (const masks of Object.values(this.modifiedMasks)) {
      for (const mask of masks) {
        mask.cancel();
      }
    }
  }

  async enable() {
    await this.character.enableItem(this);
    this.updateCurrentAssets();

    return Promise.all([
      ...this.currentMasks.map((mask) => mask.enable()),
      ...this.currentAssets.map((asset) => asset.enable())
    ]);
  }

  async disable() {
    await this.character.disableItem(this);

    return Promise.all([
      ...this.currentMasks.map((mask) => mask.disable()),
      ...this.currentAssets.map((asset) => asset.disable())
    ]);
  }

  async updateModifiers() {
    for (const asset of this.currentAssets) {
      await asset.disable();
    }
    this.updateCurrentAssets();
    for (const asset of this.currentAssets) {
      await asset.enable();
    }
  }

  updateCurrentAssets() {
    this.currentAssets = this.assets;
    this.currentMasks = this.masks;
    for (const [modifier, assets] of this.modifiedAssets.entries()) {
      if (this.character.activeModifiers.has(modifier)) {
        this.currentAssets = assets;
        this.currentMasks = this.modifiedMasks.get(modifier)!;
        break;
      }
    }
    if (this.activeVariant !== null) {
      this.currentAssets[this.variantAssetIndex] = this.variantAssets[this.activeVariant];
    }
  }

  get categoryName() {
    return this.category.name;
  }

  async setColorOrVariant(index: number) {
    if (this.colors) {
      return this.setColor(index);
    } else {
      return this.setVariant(index);
    }
  }

  async setColor(index: number) {
    this.activeColor = this.colors![index];
    for (const asset of this.currentAssets) {
      await asset.refreshColor();
    }
  }

  async setVariant(index: number) {
    await this.currentAssets[this.variantAssetIndex].disable();
    this.activeVariant = index;
    this.updateCurrentAssets();
    await this.currentAssets[this.variantAssetIndex].enable();
  }

  get color() {
    return this.activeColor;
  }

  get variant() {
    return this.activeVariant;
  }
}
