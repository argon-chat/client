/**
 * A profile card wearing something, laid out by a real browser: the popover a member list opens and
 * the preview in the profile settings.
 *
 * Nothing worn on the avatar may be cut off by the glass it overlaps, in either theme. The card's own
 * outer glow stays behind the portal box as it always did, a frame takes over only the edges it
 * covers, and a styled name in the preview is as wide as its letters.
 */

import "../../../packages/assets/styles/index.css";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  flushPromises,
  mount,
  type VueWrapper,
} from "@vue/test-utils";
import {
  createPinia,
  setActivePinia,
} from "pinia";
import { page } from "vitest/browser";
import {
  UserStatus,
  type ArgonUserProfile,
} from "@argon/glue";

const h = await vi.hoisted(async () => {
  const { defineComponent } = await import("vue");

  return {
    stub: (name: string) => ({ default: defineComponent({ name, setup: () => () => null }) }),
    getCatalogue: vi.fn(),
    profile: null as unknown,
    face: `data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10' fill='lime'/></svg>")}`,
  };
});

vi.mock("@/lib/telemetry/metrics", () => ({ metrics: { count() {}, distribution() {} }, errorKind: () => "network" }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    cosmeticsInteraction: {
      GetCatalogue: h.getCatalogue,
      GetMyCosmetics: async () => ({ owned: [] }),
    },
  }),
}));
vi.mock("@/store/system/fileStorage", async () => {
  const { RING_FILE } = await import("./support/catalogue");

  return {
    cdnUrl: (fileId: string) => (fileId === "face-file" ? h.face : RING_FILE),
    cdnFetchUrl: () => RING_FILE,
    cdnCrossOrigin: () => undefined,
  };
});
vi.mock("@/store/auth/meStore", () => ({
  useMe: () => ({ me: { userId: "me" }, meProfile: null, statusClass: () => "online" }),
}));
vi.mock("@/store/chat/userColors", () => ({ useUserColors: () => ({ getColorByUserId: () => "#334455" }) }));
vi.mock("@/store/data/poolStore", async () => {
  const { computed } = await import("vue");

  return {
    usePoolStore: () => ({
      selectedServer: null,
      getUserReactive: () => computed(() => null),
      generateBadgesByArchetypes: async () => [],
      getUser: async (userId: string) => ({
        userId,
        username: "alice",
        displayName: "Alice",
        avatarFileId: "face-file",
        flags: 0,
        status: UserStatus.Online,
        activity: null,
      }),
    }),
  };
});
vi.mock("@/store/data/profileCacheStore", () => ({
  useProfileCacheStore: () => ({
    getProfile: async () => h.profile,
    getStatus: async () => null,
    revisionOf: () => 0,
  }),
}));
vi.mock("@/store/features/connectionsStore", () => ({ useConnectionsStore: () => ({ connectionsOf: async () => [] }) }));
vi.mock("@/components/connections/SpotifyActivityCard.vue", () => h.stub("SpotifyActivityCard"));
vi.mock("@/components/connections/ProfileConnections.vue", () => h.stub("ProfileConnections"));
vi.mock("@/components/expressions/StatusEmoji.vue", () => h.stub("StatusEmoji"));

import ProfileCardPreview from "@/components/settings/ProfileCardPreview.vue";
import UserProfilePopover from "@/components/popovers/UserProfilePopover.vue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";

import {
  BAND_ID,
  GLOW_ID,
  HALO_ID,
  RED,
  BLUE,
  catalogue,
  nickname,
  wearingItems,
  type Worn,
} from "./support/catalogue";
import { screenPixels } from "./support/screenPixels";

const ACCENT = 0xff3366ff | 0;

const mounted: VueWrapper[] = [];

async function until(check: () => boolean, timeout = 5_000) {
  const deadline = performance.now() + timeout;

  while (!check()) {
    if (performance.now() > deadline) {
      throw new Error("timed out");
    }

    await new Promise(resolve => setTimeout(resolve, 16));
  }
}

function theme(name: "dark" | "light") {
  localStorage.setItem("appearance.theme", JSON.stringify({ json: name }));
  document.documentElement.classList.toggle("dark", name === "dark");
}

function host(width = 520): HTMLElement {
  const box = document.createElement("div");

  box.style.cssText = `position: absolute; left: 80px; top: 120px; width: ${width}px; background: hsl(var(--background));`;
  document.body.appendChild(box);

  return box;
}

async function preview(profile: Worn, extra: Record<string, unknown> = {}) {
  const wrapper = mount(ProfileCardPreview, {
    attachTo: host(),
    props: {
      displayName: "Alice",
      username: "alice",
      userId: "u1",
      avatarFileId: "face-file",
      isPremium: false,
      primaryColor: null,
      accentColor: null,
      profile,
      ...extra,
    },
  });

  mounted.push(wrapper);
  await flushPromises();

  return wrapper.element as HTMLElement;
}

/** The popover as a member list opens it: the card inside the portal box the hosts give it. */
async function popover(profile: Partial<ArgonUserProfile>) {
  h.profile = {
    userId: "u1",
    badges: [],
    archetypes: [],
    bio: null,
    primaryColor: null,
    accentColor: null,
    connections: [],
    customStatus: null,
    customStatusIconId: null,
    customStatusEmoji: null,
    cosmetics: [],
    ...profile,
  };

  const box = host();
  const portal = document.createElement("div");

  portal.className = "profile-popover p-0 rounded-2xl shadow-xl border border-border bg-popover text-popover-foreground overflow-visible";
  portal.style.width = "24rem";
  box.appendChild(portal);

  const wrapper = mount(UserProfilePopover, { attachTo: portal, props: { userId: "u1" } });

  mounted.push(wrapper);
  await until(() => !!document.querySelector(".popover-inner .hero-avatar"));
  await flushPromises();

  return portal;
}

/** Lets a hit test find what a decoration covers: its own pointer-events are off on purpose. */
function hittable(): () => void {
  const style = document.createElement("style");

  style.textContent = ".cosmetic-image-layer { pointer-events: auto !important; }";
  document.head.appendChild(style);

  return () => style.remove();
}

function hitAt(x: number, y: number): Element | null {
  return document.elementFromPoint(x, y);
}

function rectOf(selector: string, root: ParentNode = document): DOMRect {
  return root.querySelector(selector)!.getBoundingClientRect();
}

beforeEach(async () => {
  await page.viewport(1200, 900);
  setActivePinia(createPinia());
  h.getCatalogue.mockReset();
  h.getCatalogue.mockResolvedValue(catalogue());
  await useCosmeticsStore().ensureLoaded();
  theme("dark");
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) {
    wrapper.unmount();
  }

  document.body.innerHTML = "";
  localStorage.removeItem("appearance.theme");
});

describe.each([
  ["dark", "dark"],
  ["light", "light"],
] as const)("an avatar on a card, %s theme", (_label, name) => {
  test("the popover shows the whole avatar and its decoration above the glass", async () => {
    theme(name);

    const card = await popover({ cosmetics: wearingItems(HALO_ID).cosmetics });
    const ring = card.querySelector<HTMLElement>(".hero-avatar")!;
    const decoration = card.querySelector<HTMLElement>(".cosmetic-image-layer")!;
    const ringBox = ring.getBoundingClientRect();
    const decorationBox = decoration.getBoundingClientRect();
    const release = hittable();

    try {
      expect(ring.contains(hitAt(ringBox.left + ringBox.width / 2, ringBox.top + 2))).toBe(true);
      expect(hitAt(decorationBox.left + decorationBox.width / 2, decorationBox.top + 2)).toBe(decoration);
    } finally {
      release();
    }
  });

  test("the settings preview shows the whole avatar and its decoration above the glass", async () => {
    theme(name);

    const card = await preview(wearingItems(HALO_ID));
    const ring = card.querySelector<HTMLElement>(".preview-avatar")!;
    const decoration = card.querySelector<HTMLElement>(".cosmetic-image-layer")!;
    const ringBox = ring.getBoundingClientRect();
    const decorationBox = decoration.getBoundingClientRect();
    const release = hittable();

    try {
      expect(ring.contains(hitAt(ringBox.left + ringBox.width / 2, ringBox.top + 2))).toBe(true);
      expect(hitAt(decorationBox.left + decorationBox.width / 2, decorationBox.top + 2)).toBe(decoration);
    } finally {
      release();
    }
  });

  test("the glass still rounds the card's bottom corners", async () => {
    theme(name);

    const card = await popover({ cosmetics: wearingItems(HALO_ID).cosmetics });
    const inner = card.querySelector<HTMLElement>(".popover-inner")!;
    const box = inner.getBoundingClientRect();

    // Just inside the bottom-left corner, outside the 16px radius: nothing of the card is there.
    expect(inner.contains(hitAt(box.left + 1.5, box.bottom - 1.5))).toBe(false);
    expect(inner.contains(hitAt(box.left + 20, box.bottom - 20))).toBe(true);
  });
});

describe("the popover's own shadows", () => {
  function outerLayers(element: Element): string[] {
    const shadow = getComputedStyle(element).boxShadow;

    if (shadow === "none") {
      return [];
    }

    return shadow.split(/,(?![^(]*\))/).map(layer => layer.trim()).filter(layer => !layer.includes("inset"));
  }

  test("an accent glow does not spill outside the portal box", async () => {
    const card = await popover({ accentColor: ACCENT });

    expect(outerLayers(card.querySelector(".popover-inner")!)).toEqual([]);
  });

  test("the light theme draws no ring of its own over the portal's border", async () => {
    theme("light");

    const card = await popover({});

    expect(outerLayers(card.querySelector(".popover-inner")!)).toEqual([]);
  });
});

describe("a frame's edges on the popover", () => {
  test("a band along the top takes over the top border only", async () => {
    const card = await popover({ cosmetics: wearingItems(BAND_ID).cosmetics });
    const border = getComputedStyle(card);
    const transparent = "rgba(0, 0, 0, 0)";

    expect(border.borderTopColor).toBe(transparent);
    expect(border.borderRightColor).not.toBe(transparent);
    expect(border.borderBottomColor).not.toBe(transparent);
    expect(border.borderLeftColor).not.toBe(transparent);
  });

  test("a card wearing nothing keeps every edge", async () => {
    const card = await popover({});
    const border = getComputedStyle(card);

    expect(border.borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
  });
});

describe("a styled name in the preview", () => {
  function textWidth(element: Element): number {
    const range = document.createRange();

    range.selectNodeContents(element);

    return range.getBoundingClientRect().width;
  }

  test("is as wide as its letters, so a gradient spans the name and not the column", async () => {
    const card = await preview({ cosmetics: [nickname([RED, BLUE])] });
    const name = card.querySelector<HTMLElement>(".preview-name")!;
    const column = rectOf(".preview-info", card);

    expect(name.getBoundingClientRect().width).toBeLessThan(column.width - 20);
    expect(Math.abs(name.getBoundingClientRect().width - textWidth(name))).toBeLessThan(2);
  });

  test("still ends in an ellipsis when it does not fit", async () => {
    const card = await preview({ cosmetics: [nickname([RED, BLUE])] }, { displayName: "Alice ".repeat(20).trim() });
    const name = card.querySelector<HTMLElement>(".preview-name")!;
    const column = rectOf(".preview-info", card);

    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
    expect(name.getBoundingClientRect().right).toBeLessThanOrEqual(column.right + 0.5);
  });

  test("a glow is not cut to a hard edge by the name's truncation", async () => {
    const card = await preview({ cosmetics: [nickname([RED], GLOW_ID)] });
    const name = card.querySelector<HTMLElement>(".preview-name")!;
    const box = name.getBoundingClientRect();
    const pixels = await screenPixels();
    let strongest = 0;

    for (let offset = 3; offset <= 6; offset++) {
      const [red, green, blue] = pixels.at(box.left - offset, box.top + box.height / 2);

      strongest = Math.max(strongest, red - Math.max(green, blue));
    }

    expect(strongest).toBeGreaterThan(8);
  });
});
