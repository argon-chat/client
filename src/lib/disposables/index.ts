import { Subject, Subscription } from "rxjs";

export class DisposableBag {
  subscription = new Subscription();
  disposers: IDisposable[] = [];

  add<T>(val: Disposable<T>): void {
    this.disposers.push(val);
  }
  addSubscription(sub: Subscription): void {
    this.subscription.add(sub);
  }

  addSubject<T>(sub: Subject<T>): void {
    this.subscription.add(sub);
  }

  dispose() {
    this.subscription.unsubscribe();
    for (const d of this.disposers) d[Symbol.dispose]();
    this.disposers = [];
    this.subscription = new Subscription();
  }

  async asyncDispose() {
    this.subscription.unsubscribe();
    for (const d of this.disposers) await d[Symbol.asyncDispose]();
    this.disposers = [];
    this.subscription = new Subscription();
  }

  [Symbol.dispose]() {
    this.dispose();
  }
  async [Symbol.asyncDispose]() {
    await this.asyncDispose();
  }
}

export interface IDisposable {
  [Symbol.dispose](): void;
  [Symbol.asyncDispose](): void;
}

export class Disposable<T> implements IDisposable {
  #value: T;
  #onDestroy: (val: T) => Promise<void>;
  disposed: boolean = false;

  constructor(value: T, onDestroy: (val: T) => Promise<void>) {
    this.#value = value;
    this.#onDestroy = onDestroy;
  }

  public get Value(): T {
    if (this.disposed)
      throw new Error("cannot access to value, object disposed");
    return this.#value;
  }

  dispose() {
    if (this.disposed) throw new Error("object disposed already");
    this.disposed = true;
    this.#onDestroy(this.#value);
  }

  async asyncDispose() {
    if (this.disposed) throw new Error("object disposed already");
    this.disposed = true;
    await this.#onDestroy(this.#value);
  }

  [Symbol.dispose]() {
    this.dispose();
  }

  async [Symbol.asyncDispose]() {
    await this.asyncDispose();
  }

  injectInto(bag: DisposableBag): T {
    if (this.disposed) throw new Error("object disposed already");
    bag.add(this);
    return this.#value;
  }
}