export default class AsyncImage {
  private src: string;
  private request: Promise<void> | undefined;
  private controller = new AbortController();

  image: CanvasImageSource | undefined;

  static loadFunc:
      (url: string, init?: RequestInit|undefined) => Promise<CanvasImageSource> = (url, init) => {
        return fetch(url, init)
            .then((res) => {
              if (res.status === 404) {
                throw new Error('image doesn\'t exist');
              } else {
                return res;
              }
            })
            .then(res => res.blob())
            .then(blob => createImageBitmap(blob))
            .catch(() => {
              console.log('Could not load image:', url);
              return createImageBitmap(new ImageData(1, 1));
            });
      };

  constructor(src: string) {
    this.src = src;
  }

  cancel() {
    this.controller.abort();
  }

  load() {
    if (!this.request) {
      this.request = new Promise((resolve) => {
        const signal = this.controller.signal;
        AsyncImage.loadFunc(this.src, {signal}).then((img) => {
          this.image = img;
          resolve();
        });
      });
    }

    return this.request;
  }

  isLoading(): boolean {
    return !!this.request;
  }
}
