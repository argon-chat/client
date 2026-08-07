import { type Subject, Subscription } from "rxjs";
import { logger } from "../logger";

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

  /**
   * Detach everything up front, so a member that throws mid-teardown cannot leave the
   * bag holding disposers that were never run — and so the bag is immediately reusable.
   */
  #drain(): { subscription: Subscription; disposers: IDisposable[] } {
    const taken = { subscription: this.subscription, disposers: this.disposers };
    this.subscription = new Subscription();
    this.disposers = [];
    return taken;
  }

  /**
   * A bag is a teardown mechanism: one badly behaved member must not stop the rest from
   * being released. Failures are reported and the loop continues, rather than
   * propagating and stranding everything enrolled after the culprit.
   */
  #report(err: unknown): void {
    logger.error("[DisposableBag] a disposer threw during teardown", err);
  }

  dispose() {
    const { subscription, disposers } = this.#drain();

    try {
      subscription.unsubscribe();
    } catch (err) {
      this.#report(err);
    }

    for (const d of disposers) {
      try {
        d[Symbol.dispose]();
      } catch (err) {
        this.#report(err);
      }
    }
  }

  async asyncDispose() {
    const { subscription, disposers } = this.#drain();

    try {
      subscription.unsubscribe();
    } catch (err) {
      this.#report(err);
    }

    for (const d of disposers) {
      try {
        await d[Symbol.asyncDispose]();
      } catch (err) {
        this.#report(err);
      }
    }
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
  disposed = false;

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
