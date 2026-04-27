export default class MapToArray<T1, T2> {
  private map: Map<T1, T2[]>;

  constructor() {
    this.map = new Map();
  }

  get(key: T1): T2[] {
    return this.map.get(key) || [];
  }

  has(key: T1): boolean {
    return this.get(key).length > 0;
  }

  sortedKeys(sortFn: (a: T1, b: T1) => number): T1[] {
    return [...this.map.keys()].sort(sortFn);
  }

  add(key: T1, value: T2) {
    const curVal = this.get(key);
    curVal.push(value);
    this.map.set(key, curVal);
  }

  remove(key: T1, value: T2) {
    let curVal = this.get(key);
    curVal = curVal.filter((x) => x !== value);
    this.map.set(key, curVal);
  }

  clear() {
    this.map.clear();
  }

  entries(): IterableIterator<[T1, T2[]]> {
    return this.map.entries();
  }
}
