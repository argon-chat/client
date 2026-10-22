/**
 * What somebody wears on the busiest rows, laid out and painted by a real browser.
 *
 * A decoration drawn beneath the face sits behind it, and none sits over the status dot. A styled
 * author name paints the tails of its letters without moving anything in the message, and a glow on
 * a member-list name is not cut to a hard rectangle by the name's truncation, which still works.
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
import { h as render } from "vue";
import { page } from "vitest/browser";
import { UserStatus } from "@argon/glue";

const h = await vi.hoisted(async () => {
  const { defineComponent } = await import("vue");

  return {
    stub: (name: string) => ({ default: defineComponent({ name, setup: () => () => null }) }),
    getCatalogue: vi.fn(),
    getStatus: vi.fn(),
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

  return { cdnUrl: () => RING_FILE, cdnFetchUrl: () => RING_FILE, cdnCrossOrigin: () => undefined };
});
vi.mock("@/store/auth/meStore", () => ({
  useMe: () => ({ me: { userId: "me" }, meProfile: null, statusClass: () => "online" }),
}));
vi.mock("@/store/chat/userColors", () => ({ useUserColors: () => ({ getColorByUserId: () => "#334455" }) }));
vi.mock("@/store/data/poolStore", async () => {
  const { computed } = await import("vue");

  return { usePoolStore: () => ({ selectedServer: "s1", getUserReactive: () => computed(() => null) }) };
});
vi.mock("@/store/data/profileCacheStore", () => ({
  useProfileCacheStore: () => ({ getStatus: h.getStatus, revisionOf: () => 0 }),
}));
vi.mock("@/components/expressions/StatusEmoji.vue", () => h.stub("StatusEmoji"));
vi.mock("@/components/popovers/UserProfilePopover.vue", () => h.stub("UserProfilePopover"));
vi.mock("@/components/modals/ReportDialog.vue", () => h.stub("ReportDialog"));
vi.mock("@/store/media/unifiedCallStore", () => ({ useUnifiedCall: () => ({ connectedVoiceChannelId: null }) }));
vi.mock("@/store/system/systemStore", () => ({ useSystemStore: () => ({ headphoneMuted: false }) }));
vi.mock("@/store/data/friendsStore", () => ({ useFriendsStore: () => ({ isBlocked: () => false }) }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push() {} }) }));

import ArgonAvatar from "@/components/ArgonAvatar.vue";
import UserInListSideElement from "@/components/UserInListSideElement.vue";
import CosmeticNickname from "@/cosmetics/CosmeticNickname.vue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";

import {
  BLUE,
  GLOW_ID,
  HALO_ID,
  RED,
  UNDER_ID,
  catalogue,
  nickname,
  wearingItems,
  type Worn,
} from "./support/catalogue";
import { screenPixels } from "./support/screenPixels";

const mounted: VueWrapper[] = [];

function host(width: number): HTMLElement {
  const box = document.createElement("div");

  box.style.cssText = `position: absolute; left: 60px; top: 60px; width: ${width}px; background: rgb(0, 0, 0);`;
  document.body.appendChild(box);

  return box;
}

/** Lets a hit test find what a decoration covers: its own pointer-events are off on purpose. */
function hittable(): () => void {
  const style = document.createElement("style");

  style.textContent = ".cosmetic-image-layer { pointer-events: auto !important; }";
  document.head.appendChild(style);

  return () => style.remove();
}

function textBox(element: Element): DOMRect {
  const range = document.createRange();

  range.selectNodeContents(element);

  return range.getBoundingClientRect();
}

async function memberRow(userId: string, worn: Worn, displayName = "Alice Gyp") {
  h.getStatus.mockResolvedValue(worn);

  const user = { userId, username: "alice", displayName, avatarFileId: "face-file", flags: 0, status: UserStatus.Online };
  const wrapper = mount(UserInListSideElement, { props: { user: user as never, enablePopup: false }, attachTo: host(220) });

  mounted.push(wrapper);
  await flushPromises();

  return wrapper.element as HTMLElement;
}

/** The author line of a message, as MessageItem lays it out, with the bubble under it. */
async function authorLine(worn: Worn | null) {
  const box = host(300);
  const wrapper = mount({
    render: () => render("div", [
      render("div", { class: "flex items-center gap-1.5 mb-0.5" }, [
        render(CosmeticNickname, {
          class: "text-[13px] font-semibold leading-none",
          surface: "nicknameInMessages",
          profile: worn,
          fallbackColor: "rgb(255, 0, 0)",
        }, () => "gyppy jaq"),
        render("span", { class: "text-[11px] leading-none" }, "12:00"),
      ]),
      render("div", { class: "bubble px-3 py-2" }, "hello"),
    ]),
  }, { attachTo: box });

  mounted.push(wrapper);
  await flushPromises();

  return box;
}

beforeEach(async () => {
  await page.viewport(1000, 700);
  setActivePinia(createPinia());
  h.getCatalogue.mockReset();
  h.getStatus.mockReset();
  h.getCatalogue.mockResolvedValue(catalogue());
  await useCosmeticsStore().ensureLoaded();
  document.documentElement.classList.add("dark");
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) {
    wrapper.unmount();
  }

  document.body.innerHTML = "";
});

describe("a decoration on an avatar", () => {
  test("drawn beneath the face sits behind it, and no further", async () => {
    const wrapper = mount(ArgonAvatar, {
      props: { fileId: "face-file", fallback: "A", userId: "u1", overridedSize: 60, profile: wearingItems(UNDER_ID) },
      attachTo: host(200),
    });

    mounted.push(wrapper);
    await flushPromises();

    // The avatar the decoration is drawn in: the component renders a comment ahead of its root.
    const decoration = document.querySelector(".cosmetic-image-layer")!;
    const root = decoration.parentElement!;
    const box = root.getBoundingClientRect();
    const release = hittable();

    try {
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

      expect(hit?.classList.contains("cosmetic-image-layer")).toBe(false);
      expect(root.contains(hit)).toBe(true);

      // Past the face, where only the decoration is: still drawn there, not sunk under the row.
      const outside = decoration.getBoundingClientRect();

      expect(document.elementFromPoint(outside.left + outside.width / 2, outside.top + 2)).toBe(decoration);
    } finally {
      release();
    }
  });

  test.each([
    ["over", HALO_ID],
    ["beneath", UNDER_ID],
  ])("drawn %s the face never covers the status dot beside it", async (_where, decorationId) => {
    const row = await memberRow(`u-${decorationId}`, wearingItems(decorationId));
    const dot = row.querySelector(".status-dot")!;

    expect(row.querySelector(".cosmetic-image-layer")).not.toBeNull();

    const box = dot.getBoundingClientRect();
    const release = hittable();

    try {
      expect(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)).toBe(dot);
    } finally {
      release();
    }
  });
});

describe("a styled author name", () => {
  test("paints its descenders: the letters fit inside the box its background is drawn in", async () => {
    const line = await authorLine({ cosmetics: [nickname([RED, BLUE])] });
    const name = line.querySelector(".cosmetic-text-style")!;
    const painted = name.getBoundingClientRect();
    const letters = textBox(name);

    expect(painted.bottom).toBeGreaterThanOrEqual(letters.bottom - 0.5);
    expect(painted.top).toBeLessThanOrEqual(letters.top + 0.5);
  });

  test("moves nothing in the message: the bubble sits where an unstyled name leaves it", async () => {
    const styled = await authorLine({ cosmetics: [nickname([RED, BLUE])] });
    const plain = await authorLine(null);
    const offset = (line: HTMLElement) => line.querySelector(".bubble")!.getBoundingClientRect().top - line.getBoundingClientRect().top;

    expect(offset(styled)).toBeCloseTo(offset(plain), 1);
  });
});

describe("a glowing name in the member list", () => {
  test("keeps its halo past the box instead of a hard edge", async () => {
    const row = await memberRow("u-glow", { cosmetics: [nickname([RED], GLOW_ID)] });
    const name = row.querySelector(".user-name")!;

    expect(name.classList.contains("cosmetic-text-style")).toBe(true);

    const box = name.getBoundingClientRect();
    const pixels = await screenPixels();
    let strongest = 0;

    for (let offset = 3; offset <= 6; offset++) {
      const [red, green, blue] = pixels.at(box.left - offset, textBox(name).top + textBox(name).height / 2);

      strongest = Math.max(strongest, red - Math.max(green, blue));
    }

    expect(strongest).toBeGreaterThan(8);
  });

  test("still ends in an ellipsis inside the row", async () => {
    const row = await memberRow("u-glow", { cosmetics: [nickname([RED], GLOW_ID)] }, "Alice Gyp ".repeat(8).trim());
    const name = row.querySelector<HTMLElement>(".user-name")!;

    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
    expect(name.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right + 0.5);
  });

  test("lets no letter past the box: the room a halo gets is not room for the text", async () => {
    const row = await memberRow("u-long", { cosmetics: [nickname([RED, BLUE])] }, "Alice Gyp ".repeat(8).trim());
    const box = row.querySelector(".user-name")!.getBoundingClientRect();
    const pixels = await screenPixels();
    let strongest = 0;

    for (let offset = 2; offset <= 12; offset++) {
      for (let line = box.top + 2; line <= box.bottom - 2; line += 2) {
        const [red, green, blue] = pixels.at(box.right + offset, line);

        strongest = Math.max(strongest, Math.max(red, blue) - green);
      }
    }

    expect(strongest).toBeLessThan(30);
  });
});
