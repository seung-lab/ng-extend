import Category from './category';
import {AVATAR_BASE_URL} from './config';
import Item from './item';
import ItemLayer from './item_layer';
import JSONCache from './json_cache';
import MapToArray from './map_to_array';
import Mask from './mask';
import PromiseQueue from './promise_queue';
import Renderer from './renderer';

export enum Gender {
  Male,
  Female
}

export default class Character {
  activeAssets: MapToArray<number, ItemLayer>;
  activeMasks: MapToArray<number, Mask>;
  activeDisables: MapToArray<string, Item>;
  activeModifiers: MapToArray<string, Item>;
  activeItems: Set<Item>;
  activeEffect: string = '';
  sections: MapToArray<string, string>;
  itemRenderQueue: PromiseQueue;
  renderer: Renderer;
  needsRender: boolean;
  gender: Gender;
  categories: Map<string, Category>;
  disabledLayers: Set<number>;

  private jsonCache: JSONCache;
  private shouldCancel: boolean = false;

  static async createCharacter(gender: Gender, renderer: Renderer) {
    const char = new Character(gender, renderer);
    await char.createCategories();
    return char;
  }

  static async createFromJSONString(jsonStr: string, renderer: Renderer): Promise<Character> {
    let jsonObj = null;
    try {
      jsonObj = JSON.parse(jsonStr);
    } catch (error) {
      console.error('Invalid JSON:', jsonStr, '\n', error);
      return Promise.reject();
    }
    return this.createFromJSON(jsonObj, renderer);
  }

  static async createFromJSON(jsonObj: any, renderer: Renderer) {
    const gender = Gender[<keyof typeof Gender>jsonObj.gender];
    const char = new Character(gender, renderer);
    await char.createCategories();

    char.setEffect(jsonObj.effect);

    const itemsObj = jsonObj.items;
    for (const [categoryName, item] of Object.entries<any>(itemsObj)) {
      const itemName = item.item;
      await char.selectItem(categoryName, itemName);

      const colorOrVariant = item.color !== undefined ? item.color : item.variant;
      if (colorOrVariant !== undefined) {
        await char.setItemColorOrVariant(itemName, categoryName, colorOrVariant, false);
      }
    }

    return char;
  }

  constructor(gender: Gender, renderer: Renderer) {
    this.gender = gender;
    this.renderer = renderer;
    this.needsRender = true;
    this.categories = new Map<string, Category>();
    this.sections = new MapToArray<string, string>();
    this.activeAssets = new MapToArray<number, ItemLayer>();
    this.activeMasks = new MapToArray<number, Mask>();
    this.activeDisables = new MapToArray<string, Item>();
    this.activeModifiers = new MapToArray<string, Item>();
    this.activeItems = new Set<Item>();
    this.disabledLayers = new Set<number>();
    this.jsonCache = new JSONCache();
    this.itemRenderQueue = new PromiseQueue();
    this.setEffect('');
  }

  async createCategories() {
    const commonAssetsJSONPath = `${AVATAR_BASE_URL}assets-common.json`;
    const genderAssetsJSONPath =
        this.getGenderedValue(`${AVATAR_BASE_URL}assets-male.json`, `${AVATAR_BASE_URL}assets-female.json`);
    const commonAssetsJSON = await this.jsonCache.loadJSONAndCache(commonAssetsJSONPath);
    const genderAssetsJSON = await this.jsonCache.loadJSONAndCache(genderAssetsJSONPath);
    if (this.shouldCancel) {
      return;
    }

    const combinedJSON = this.mergeObjects(commonAssetsJSON, genderAssetsJSON);
    Category.layers = combinedJSON.layers;

    for (const [sectionName, section] of Object.entries<any>(combinedJSON.sections)) {
      for (const [categoryName, categoryJSON] of Object.entries<any>(section.categories)) {
        this.sections.add(sectionName, categoryName);
        const category = new Category(categoryName, categoryJSON.default, !!categoryJSON.optional);
        this.categories.set(categoryName, category);
        categoryJSON.name = categoryName;

        let firstItem: Item|undefined;
        for (const itemJSON of categoryJSON.items) {
          const useCommonPath = Item.getProperty('useCommonPath', itemJSON, categoryJSON, false);
          const rawPath = useCommonPath ? commonAssetsJSON.path : genderAssetsJSON.path;
          const path = rawPath.replace(/^\.\//, AVATAR_BASE_URL);
          const item = new Item(
              itemJSON, categoryJSON, `${path}/${sectionName}/${categoryName}`, category, this);
          category.addAvailableItem(item);
          if (!firstItem) {
            firstItem = item;
          }
        }

        if (category.defaultItem || !category.optional) {
          const defaultItem = category.defaultItem || firstItem!.name;
          await this.selectItem(categoryName, defaultItem);
        }
      }
    }
  }

  private mergeObjects(a: any, b: any): any {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.concat(b);
    }
    if (Object(a) !== a) return a;
    if (Object(b) !== b) return b;

    const c: any = {};
    for (const [key, val] of Object.entries(a)) {
      c[key] = val;
    }
    for (const [key, val] of Object.entries(b)) {
      if (c.hasOwnProperty(key)) {
        c[key] = this.mergeObjects(c[key], val);
      } else {
        c[key] = val;
      }
    }
    return c;
  }

  cancel() {
    this.shouldCancel = true;
    this.itemRenderQueue.cancel();
    for (const category of this.categories.values()) {
      category.cancel();
    }
  }

  async selectItem(categoryName: string, itemName: string) {
    const category = this.categories.get(categoryName);
    if (!category) {
      console.error('Invalid category:', categoryName);
      return;
    }
    await category.chooseItem(itemName);
    this.needsRender = true;
  }

  async enableItem(item: Item) {
    for (const disable of item.disables) {
      this.activeDisables.add(disable, item);
      if (this.activeDisables.get(disable).length === 1) {
        const disableCategory = this.categories.get(disable);
        if (disableCategory) {
          await disableCategory.disable();
        } else {
          const layer = Category.getLayerIndex(disable);
          this.disabledLayers.add(layer);
        }
      }
    }

    for (const modifier of item.modifiers) {
      this.activeModifiers.add(modifier, item);

      if (this.activeModifiers.get(modifier).length === 1) {
        await this.updateModifiers();
      }
    }

    this.activeItems.add(item);
  }

  async disableItem(item: Item) {
    for (const disable of item.disables) {
      this.activeDisables.remove(disable, item);
      if (this.activeDisables.get(disable).length === 0) {
        const enableCategory = this.categories.get(disable);
        if (enableCategory) {
          await enableCategory.enable();
        } else {
          const layer = Category.getLayerIndex(disable);
          this.disabledLayers.delete(layer);
        }
      }
    }

    this.activeItems.delete(item);

    for (const modifier of item.modifiers) {
      this.activeModifiers.remove(modifier, item);

      if (this.activeModifiers.get(modifier).length === 0) {
        await this.updateModifiers();
      }
    }
  }

  private async updateModifiers() {
    for (const item of this.activeItems) {
      await item.updateModifiers();
    }
  }

  async setEffect(effect: string) {
    this.activeEffect = effect;
    this.renderer.applyFilter(effect);
    this.needsRender = true;
  }

  getGenderedValue<T>(maleValue: T, femaleValue: T): T {
    switch (this.gender) {
      case Gender.Male:
        return maleValue;
      case Gender.Female:
        return femaleValue;
    }
  }

  getHeadHeight(): number {
    return this.getGenderedValue(0.4, 0.3);
  }

  toJSON(): string {
    const jsonObj: any = {};
    jsonObj.gender = Gender[this.gender];
    jsonObj.effect = this.activeEffect;
    const itemsObj: any = {};
    for (const item of this.activeItems) {
      const itemName = item.name;
      const categoryName = item.categoryName;
      const itemObj: any = {};
      itemObj.item = itemName;
      if (item.color) {
        itemObj.color = item.colors?.indexOf(item.color);
      }
      if (item.variant !== null) {
        itemObj.variant = item.variant;
      }
      itemsObj[categoryName] = itemObj;
    }
    jsonObj.items = itemsObj;

    return JSON.stringify(jsonObj);
  }

  async setItemColorOrVariant(itemName: string, categoryName: string, index: number, render = true) {
    const item = this.categories.get(categoryName)?.getItem(itemName);
    if (item) {
      await item.setColorOrVariant(index);
      if (render) {
        this.needsRender = true;
      }
    } else {
      console.error('Invalid item:', itemName, 'in category:', categoryName);
    }
  }

  getCategory(categoryName: string): Category {
    return this.categories.get(categoryName)!;
  }

  render(renderBackground: boolean = true) {
    if (this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this, renderBackground);
    }
  }
}
