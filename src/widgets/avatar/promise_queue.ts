export default class PromiseQueue {
  private promise: Promise<void>;
  private shouldStop: boolean;

  constructor() {
    this.promise = Promise.resolve();
    this.shouldStop = false;
  }

  add(f: () => void) {
    this.promise = this.promise.then(() => {
      if (!this.shouldStop) {
        return f();
      }
    });
  }

  cancel() {
    this.shouldStop = true;
  }

  async wait() {
    await this.promise;
  }
}
