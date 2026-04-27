export default class JSONCache {
  private cache = new Map<string, Promise<Response>>();

  static loadFunc: (url: string) => Promise<Response> = (url) => {
    return fetch(url);
  };

  async loadJSONAndCache(url: string): Promise<any> {
    if (!this.cache.has(url)) {
      this.cache.set(url, JSONCache.loadFunc(url));
    }

    const res = await this.cache.get(url)!;
    const obj = await res.clone().json();
    return JSON.parse(JSON.stringify(obj));
  }
}
