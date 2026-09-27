import { watch, type Ref, type WatchStopHandle } from "vue";
import { animationsEnabled as globalAnimationsEnabled, pickerAutoplay } from "./settings";

/** Something that can be played and paused: a Lottie player, a video, a shared emoji clock. */
export interface AnimatedItem {
  /** Played only while this element intersects the viewport. Null: visibility is set by hand. */
  el: Element | null;
  group: string;
  autoplay: boolean;
  /** Visibility of a hand-driven item before the first `setVisible`. Default: true without `el`. */
  initiallyVisible?: boolean;
  setPlaying(playing: boolean): void;
}

export interface AnimationControl {
  readonly playing: boolean;
  readonly visible: boolean;
  /** Plays even without autoplay (a hover, a click) — still only while visible. */
  play(): void;
  /** Holds it paused until `play()`, whatever autoplay says. */
  pause(): void;
  setVisible(visible: boolean): void;
  setAutoplay(autoplay: boolean): void;
  /** A play-once animation reached its end: it stays paused until `play()`. */
  setEnded(): void;
  remove(): void;
}

type HiddenSource = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;

export interface AnimationIntersectorOptions {
  IntersectionObserver?: typeof IntersectionObserver | null;
  document?: HiddenSource | null;
  animationsEnabled?: Ref<boolean>;
  /** Per group: false stops that group's autoplay (a hover or click still plays). Default: the picker's setting. */
  groupAutoplay?: Readonly<Record<string, Ref<boolean>>>;
  rootMargin?: string;
}

interface Entry {
  item: AnimatedItem;
  visible: boolean;
  user: "play" | "pause" | null;
  playing: boolean;
  ended: boolean;
  removed: boolean;
}

/**
 * Decides which animations play (ported from tweb's animationIntersector). An item plays when all hold:
 * - it is visible (its element intersects the viewport, or `setVisible(true)` for hand-driven ones);
 * - the page is not hidden;
 * - it was asked to (`play()`), or autoplays with animations enabled (and its group's autoplay on),
 *   and it was not `pause()`d;
 * - no "only playable group" is set, or it is in that group;
 * - its group is not locked — a locked group (e.g. during a fast scroll) pauses what leaves the
 *   viewport but starts nothing until it is unlocked.
 */
export class AnimationIntersector {
  private readonly observer: IntersectionObserver | null;
  private readonly byElement = new Map<Element, Set<Entry>>();
  private readonly entries = new Set<Entry>();
  private readonly lockedGroups = new Set<string>();
  private onlyGroup: string | null = null;
  private hidden: boolean;
  private readonly doc: HiddenSource | null;
  private readonly enabled: Ref<boolean>;
  private readonly groupAutoplay: Readonly<Record<string, Ref<boolean>>>;
  private readonly stopWatch: WatchStopHandle;

  constructor(options: AnimationIntersectorOptions = {}) {
    const IO =
      options.IntersectionObserver === undefined
        ? typeof IntersectionObserver !== "undefined"
          ? IntersectionObserver
          : null
        : options.IntersectionObserver;
    this.observer = IO ? new IO(this.onIntersection, { rootMargin: options.rootMargin ?? "0px" }) : null;

    this.doc = options.document === undefined ? (typeof document !== "undefined" ? document : null) : options.document;
    this.hidden = this.doc?.hidden ?? false;
    this.doc?.addEventListener("visibilitychange", this.onVisibilityChange);

    this.enabled = options.animationsEnabled ?? globalAnimationsEnabled;
    this.groupAutoplay = options.groupAutoplay ?? { picker: pickerAutoplay };
    this.stopWatch = watch([this.enabled, ...Object.values(this.groupAutoplay)], () => this.refresh(), { flush: "sync" });
  }

  add(item: AnimatedItem): AnimationControl {
    const entry: Entry = {
      item,
      // Without an observer there is nothing to report visibility: treat observed items as visible.
      visible: item.el && this.observer ? false : (item.initiallyVisible ?? true),
      user: null,
      playing: false,
      ended: false,
      removed: false,
    };
    this.entries.add(entry);

    if (item.el && this.observer) {
      let set = this.byElement.get(item.el);
      if (!set) {
        set = new Set();
        this.byElement.set(item.el, set);
        this.observer.observe(item.el);
      }
      set.add(entry);
    }

    const self = this;
    const control: AnimationControl = {
      get playing() {
        return entry.playing;
      },
      get visible() {
        return entry.visible;
      },
      play() {
        entry.user = "play";
        entry.ended = false;
        self.evaluate(entry);
      },
      pause() {
        entry.user = "pause";
        self.evaluate(entry);
      },
      setVisible(visible) {
        entry.visible = visible;
        self.evaluate(entry);
      },
      setAutoplay(autoplay) {
        item.autoplay = autoplay;
        self.evaluate(entry);
      },
      setEnded() {
        entry.ended = true;
        if (entry.user === "play") entry.user = null;
        self.evaluate(entry);
      },
      remove() {
        self.remove(entry);
      },
    };

    this.evaluate(entry);
    return control;
  }

  lockGroup(group: string): void {
    this.lockedGroups.add(group);
  }

  unlockGroup(group: string): void {
    if (this.lockedGroups.delete(group)) this.refresh(group);
  }

  /** Only this group may play (a picker over the chat); null lifts it. */
  setOnlyPlayableGroup(group: string | null): void {
    this.onlyGroup = group;
    this.refresh();
  }

  get onlyPlayableGroup(): string | null {
    return this.onlyGroup;
  }

  refresh(group?: string): void {
    for (const entry of [...this.entries]) {
      if (group === undefined || entry.item.group === group) this.evaluate(entry);
    }
  }

  destroy(): void {
    for (const entry of [...this.entries]) this.remove(entry);
    this.observer?.disconnect();
    this.doc?.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.stopWatch();
  }

  private remove(entry: Entry): void {
    if (entry.removed) return;
    entry.removed = true;
    this.entries.delete(entry);
    const el = entry.item.el;
    if (el) {
      const set = this.byElement.get(el);
      if (set) {
        set.delete(entry);
        if (!set.size) {
          this.byElement.delete(el);
          this.observer?.unobserve(el);
        }
      }
    }
  }

  private shouldPlay(entry: Entry): boolean {
    if (entry.removed || entry.ended || !entry.visible || this.hidden) return false;
    if (this.onlyGroup !== null && entry.item.group !== this.onlyGroup) return false;
    const autoplays = entry.item.autoplay && this.enabled.value && (this.groupAutoplay[entry.item.group]?.value ?? true);
    const wants = entry.user === "play" || (entry.user === null && autoplays);
    if (!wants) return false;
    if (this.lockedGroups.has(entry.item.group) && !entry.playing) return false;
    return true;
  }

  private evaluate(entry: Entry): void {
    const should = this.shouldPlay(entry);
    if (should === entry.playing) return;
    entry.playing = should;
    entry.item.setPlaying(should);
  }

  private onIntersection = (records: IntersectionObserverEntry[]) => {
    for (const record of records) {
      const set = this.byElement.get(record.target);
      if (!set) continue;
      for (const entry of [...set]) {
        entry.visible = record.isIntersecting;
        this.evaluate(entry);
      }
    }
  };

  private onVisibilityChange = () => {
    const hidden = this.doc?.hidden ?? false;
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.refresh();
  };
}

let shared: AnimationIntersector | null = null;

/** The app-wide intersector every sticker, emoji and video plays through. */
export function getAnimationIntersector(): AnimationIntersector {
  return (shared ??= new AnimationIntersector());
}
