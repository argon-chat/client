/**
 * The message list, frame by frame: nothing under the reader may move except by their own scroll.
 *
 * The other scroll tests look after things have settled; a twitch lives in the frames before
 * that — one frame painted with a row at its new height and the old scroll position, corrected in
 * the next. Here a camera records every frame just before it is painted, and three things must
 * hold in each: the row the reader is looking at moved by exactly what they scrolled, no slot
 * showed another message than its own, and a list meant to sit at the bottom sat there.
 *
 * Rows are laid out the way MessageItem lays them out (an author header starting a group, text,
 * media at a placeholder until loaded, reactions), with real grouping, date and unread separators,
 * over the app's own stylesheet — so the scroller's estimates are as wrong as they are in the app.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/media/toneStore", () => ({ useTone: () => ({ playNotificationSound() {} }) }));
vi.mock("@/store/data/notificationStore", () => ({ useNotificationStore: () => ({ effectiveMuteLevel: () => 0 }) }));
vi.mock("@/store/system/apiStore", async () => {
  const s = await import("./support/chatState");
  return { useApi: () => s.api };
});
vi.mock("@/store/data/poolStore", async () => {
  const { useMessageStore } = await import("@/store/data/messageStore");
  const s = await import("./support/chatState");
  return {
    usePoolStore: () => {
      const store = useMessageStore();
      return {
        ...s.events,
        loadCachedMessages: store.loadCachedMessages,
        loadOlderCachedMessages: store.loadOlderCachedMessages,
        reconcileMessages: store.reconcileMessages,
        cacheMessages: store.cacheMessages,
        cacheMessage: store.cacheMessage,
        removeCachedMessage: store.removeCachedMessage,
        getMessageById: store.getMessageById,
      };
    },
  };
});
// A row laid out the way MessageItem lays it out; it shows which message it was given.
vi.mock("@/components/MessageItem.vue", async () => {
  const { defineComponent, h } = await import("vue");
  const s = await import("./support/chatState");
  return {
    default: defineComponent({
      name: "MessageItem",
      props: ["message", "isFirstInGroup"],
      emits: ["scroll-to-message"],
      setup: (props) => () => {
        const first = props.isFirstInGroup !== false;
        const total = s.rowHeight(props.message, first);
        const header = first ? s.HEADER : 0;
        return h("div", { "data-shown": String(props.message.messageId), style: { height: `${total}px` } }, [
          header ? h("div", { style: { height: `${header}px` } }, "author") : null,
          h("div", { "data-row-body": "", style: { height: `${total - header}px`, overflow: "hidden" } }, String(props.message.text)),
        ]);
      },
    }),
  };
});
vi.mock("@/components/chats/DateSeparator.vue", async () => {
  const { defineComponent, h } = await import("vue");
  const s = await import("./support/chatState");
  return { default: defineComponent({ name: "DateSeparator", setup: () => () => h("div", { style: { height: `${s.SEPARATOR.date}px` } }) }) };
});
vi.mock("@/components/chats/UnreadSeparator.vue", async () => {
  const { defineComponent, h } = await import("vue");
  const s = await import("./support/chatState");
  return { default: defineComponent({ name: "UnreadSeparator", setup: () => () => h("div", { style: { height: `${s.SEPARATOR.unread}px` } }) }) };
});
vi.mock("@/components/chats/ImageLightbox.vue", () => ({ default: { name: "ImageLightbox", setup: () => () => null } }));
vi.mock("@/components/shared/EmptyStateArt.vue", () => ({ default: { name: "EmptyStateArt", setup: () => () => null } }));

import { db, ensureDbOpen } from "@/store/db/dexie";
import { useMessageStore } from "@/store/data/messageStore";
import { msg, range, resetWorld, world, type Kind } from "./support/chatState";
import { jolts, late, later, mixups, offBottom, openChat, settle, unmountChat, VIEW, type ChatUnderTest } from "./support/chatHarness";

// ── The channel ──

const IMAGE = 460;
const LINK = 120;
const GIF = 220;
const FILE = 56;

/** Every third message carries media, cycling through the kinds. */
function withMedia(from: number, to: number) {
  const cycle: Kind[] = ["image", "link", "file", "gif"];
  for (let i = from; i <= to; i++) if (i % 3 === 0) world.kinds.set(BigInt(i), cycle[(i / 3) % cycle.length]);
}
const loadedHeight = (id: bigint) => ({ image: IMAGE, link: LINK, file: FILE, gif: GIF, text: 0 })[world.kinds.get(id) ?? "text"];

/** A deterministic source of randomness, so a failing seed fails again. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rendered rows by where they are: above the viewport, in it, below it. */
function around(c: ChatUnderTest) {
  const rows = [...c.shot().rows];
  return {
    above: rows.filter(([, top]) => top < -1).map(([id]) => id),
    inView: rows.filter(([, top]) => top >= -1 && top < VIEW).map(([id]) => id),
    below: rows.filter(([, top]) => top >= VIEW).map(([id]) => id),
  };
}

/** Loads the media still waiting in these rows. */
function loadMedia(ids: bigint[]) {
  for (const id of ids) if (world.kinds.has(id) && !world.loaded.has(id)) world.loaded.set(id, loadedHeight(id));
}

/** The first few offending frames, one per line, for a readable failure. */
const report = (lines: string[]) =>
  lines.slice(0, 6).join("\n") + (lines.length > 6 ? `\n… ${lines.length} frames in all` : "");

type Shots = Awaited<ReturnType<ChatUnderTest["film"]>>;

function expectSmooth(shots: Shots) {
  expect(report(mixups(shots))).toBe("");
  expect(report(late(shots))).toBe("");
  expect(report(jolts(shots))).toBe("");
}

function expectPinned(shots: Shots) {
  expect(report(mixups(shots))).toBe("");
  expect(report(late(shots))).toBe("");
  expect(report(offBottom(shots))).toBe("");
}

let c: ChatUnderTest;
let nextId = 401n;

beforeEach(async () => {
  setActivePinia(createPinia());
  await ensureDbOpen();
  await db.messages.clear();
  resetWorld(range(1, 400));
  withMedia(1, 400);
  nextId = 401n;
});

afterEach(() => unmountChat());

describe("at the bottom, every frame stays at the bottom", () => {
  test("nothing happening", async () => {
    c = await openChat();
    const shots = await c.film(30);
    expectPinned(shots);
  });

  test("messages arriving one after another", async () => {
    c = await openChat();
    const shots = await c.film(80, { act: (f) => f % 4 === 0 && later(() => c.arrive(nextId++)) });
    expectPinned(shots);
  });

  test("a burst of fifteen messages in one go", async () => {
    c = await openChat();
    const shots = await c.film(40, {
      act: (f) => f === 5 && later(() => { for (let i = 0; i < 15; i++) c.arrive(nextId++); }),
    });
    expectPinned(shots);
  });

  test("a picture arriving, then loading", async () => {
    c = await openChat();
    const id = nextId++;
    world.kinds.set(id, "image");
    const shots = await c.film(50, {
      act: (f) => {
        if (f === 5) later(() => c.arrive(id));
        if (f === 25) later(() => world.loaded.set(id, IMAGE));
      },
    });
    expectPinned(shots);
  });

  test("the pictures already on screen loading", async () => {
    c = await openChat();
    const { inView, above } = around(c);
    const shots = await c.film(50, {
      act: (f) => {
        if (f === 5) later(() => loadMedia(inView));
        if (f === 15) later(() => loadMedia(above));
      },
    });
    expectPinned(shots);
  });

  test("the last message getting reactions, a longer text, then deleted", async () => {
    c = await openChat();
    const last = c.ids().at(-1)!;
    const shots = await c.film(50, {
      act: (f) => {
        if (f === 5) later(() => { world.reactions.set(last, 2); c.update(last); });
        if (f === 15) later(() => { world.texts.set(last, "x".repeat(300)); c.update(last); });
        if (f === 25) later(() => c.remove(last));
      },
    });
    expectPinned(shots);
  });

  test("the viewport getting shorter (a reply bar opening) and taller again", async () => {
    c = await openChat();
    const host = c.box.closest("div[style]")!.parentElement as HTMLElement;
    const shots = await c.film(40, {
      act: (f) => {
        if (f === 5) host.style.height = `${VIEW - 48}px`;
        if (f === 20) host.style.height = `${VIEW}px`;
      },
    });
    expectPinned(shots);
  });
});

describe("scrolled up, nothing moves under the reader", () => {
  async function middle() {
    c = await openChat();
    await c.scrollTo(c.box.scrollHeight - VIEW - 1800);
    return c;
  }

  test("nothing happening", async () => {
    await middle();
    expectSmooth(await c.film(30));
  });

  test("messages arriving below", async () => {
    await middle();
    expectSmooth(await c.film(60, { act: (f) => f % 3 === 0 && later(() => c.arrive(nextId++)) }));
  });

  test("media loading above the viewport", async () => {
    await middle();
    expectSmooth(await c.film(40, { act: (f) => f === 5 && later(() => loadMedia(around(c).above)) }));
  });

  test("media loading in the row cut by the top edge", async () => {
    await middle();
    const cut = [...c.shot().rows].filter(([, top]) => top < 0).sort((a, b) => b[1] - a[1])[0][0];
    world.kinds.set(cut, "image");
    expectSmooth(await c.film(40, { act: (f) => f === 5 && later(() => world.loaded.set(cut, IMAGE)) }));
  });

  test("media loading below the viewport", async () => {
    await middle();
    expectSmooth(await c.film(40, { act: (f) => f === 5 && later(() => loadMedia(around(c).below)) }));
  });

  test("reactions and a longer text on rows above", async () => {
    await middle();
    expectSmooth(await c.film(40, {
      act: (f) => {
        const above = around(c).above;
        if (f === 5) later(() => { for (const id of above) { world.reactions.set(id, 1); c.update(id); } });
        if (f === 15) later(() => { const id = above.at(-1)!; world.texts.set(id, "y".repeat(240)); c.update(id); });
      },
    }));
  });

  test("messages above deleted", async () => {
    await middle();
    expectSmooth(await c.film(40, {
      act: (f) => {
        if (f === 5) later(() => { const above = around(c).above; c.remove(above.at(-1)!); });
        if (f === 15) later(() => { const above = around(c).above; c.remove(above[0]); });
      },
    }));
  });

  test("the unread line appearing above", async () => {
    await middle();
    expectSmooth(await c.film(30, {
      act: (f) => f === 5 && later(() => { const above = around(c).above; world.read.lastReadId = above[1] ?? above[0]; }),
    }));
  });

  test("the viewport getting shorter and taller again", async () => {
    await middle();
    const host = c.box.closest("div[style]")!.parentElement as HTMLElement;
    expectSmooth(await c.film(40, {
      act: (f) => {
        if (f === 5) host.style.height = `${VIEW - 48}px`;
        if (f === 20) host.style.height = `${VIEW}px`;
      },
    }));
  });
});

describe("scrolling through history, only the scroll moves the view", () => {
  test("up by trackpad steps from the bottom, pages loading from the server", async () => {
    c = await openChat();
    const shots = await c.film(220, { scroll: () => -70 });
    expectSmooth(shots);
    expect(c.ids()[0]).toBeLessThan(300n);
  });

  test("up by trackpad steps while the media above keep loading", async () => {
    c = await openChat();
    expectSmooth(await c.film(180, {
      scroll: () => -60,
      act: (f) => f % 5 === 0 && later(() => loadMedia(around(c).above)),
    }));
  });

  test("up by big wheel notches", async () => {
    c = await openChat();
    expectSmooth(await c.film(120, { scroll: (f) => (f % 6 === 0 ? -400 : 0) }));
  });

  test("up through pages the cache holds, then checked with the server", async () => {
    // The cache holds an older stretch that the server has changed since: one deleted, one edited.
    await useMessageStore().cacheMessages(range(251, 350).map((id) => msg(id)));
    world.held = world.held.filter((id) => id !== 300n);
    world.texts.set(320n, "z".repeat(200));
    c = await openChat();
    expectSmooth(await c.film(200, { scroll: () => -70 }));
  });

  test("a fling to the very top: the row at the top stays there as history loads above it", async () => {
    c = await openChat();
    const shots = await c.film(60, { scroll: (f) => (f === 2 ? -c.box.scrollTop : 0) });
    expectSmooth(shots);
    expect(c.ids()[0]).toBeLessThan(351n);
  });

  test("down again after scrolling up", async () => {
    c = await openChat();
    await c.film(100, { scroll: () => -80 });
    expectSmooth(await c.film(60, { scroll: () => 70 }));
  });
});

describe("after a jump, only the scroll moves the view", () => {
  async function jumped() {
    c = await openChat();
    await c.vm.nav.jumpToMessage(150n);
    await settle();
    return c;
  }

  test("the media around the message loading", async () => {
    await jumped();
    expectSmooth(await c.film(50, {
      act: (f) => {
        if (f === 5) later(() => loadMedia(around(c).above));
        if (f === 15) later(() => loadMedia(around(c).inView));
        if (f === 25) later(() => loadMedia(around(c).below));
      },
    }));
  });

  test("down by trackpad steps through newer pages", async () => {
    await jumped();
    expectSmooth(await c.film(160, { scroll: () => 70 }));
  });

  test("up by trackpad steps through older pages", async () => {
    await jumped();
    expectSmooth(await c.film(160, { scroll: () => -70 }));
  });

  test("back to the present lands at the bottom and stays there", async () => {
    await jumped();
    await c.vm.nav.goToPresent();
    await settle();
    expectPinned(await c.film(40, { act: (f) => f % 5 === 0 && later(() => c.arrive(nextId++)) }));
  });
});

describe("a busy channel, scrolled up: only the scroll moves the view", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    test(`seed ${seed}`, async () => {
      const random = rng(seed);
      c = await openChat();
      await c.scrollTo(c.box.scrollHeight - VIEW - 2400);

      let pace = 0;
      const shots = await c.film(240, {
        scroll: (f) => {
          if (f % 40 === 1) pace = [-120, -60, 0, 60, 90][Math.floor(random() * 5)];
          // Stay clear of the bottom, where following new messages is meant to move the view.
          if (pace > 0 && c.shot().distance < 900) pace = -pace;
          return pace;
        },
        act: () => {
          const roll = random();
          if (roll < 0.1) later(() => c.arrive(nextId++));
          else if (roll < 0.2) later(() => loadMedia(around(c).above.filter(() => random() < 0.5)));
          else if (roll < 0.28) later(() => loadMedia(around(c).below));
          else if (roll < 0.33) later(() => { const id = around(c).above.at(-1); if (id) { world.reactions.set(id, 1 + Math.floor(random() * 3)); c.update(id); } });
          else if (roll < 0.36) later(() => { const id = around(c).above[0]; if (id) { world.texts.set(id, "w".repeat(40 + Math.floor(random() * 300))); c.update(id); } });
          else if (roll < 0.38) later(() => { const id = around(c).above[0]; if (id) c.remove(id); });
        },
      });
      expectSmooth(shots);
    });
  }
});
