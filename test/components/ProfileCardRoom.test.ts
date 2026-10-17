/**
 * The room a profile card keeps between itself and the window for a frame that hangs outside it.
 *
 * A member row asks for the worn row whenever anything the card it opens could draw is on — a frame
 * alone included. A mention or a friend row keeps the room the card opened with until the card has
 * gone, rather than dropping it the moment the card starts closing and moving it mid-exit.
 */

import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  flushPromises,
  mount,
} from "@vue/test-utils";
import {
  createPinia,
  setActivePinia,
} from "pinia";
import {
  AssetSlot,
  FrameRepeat,
  FrameSurround,
  PayloadProfileFrame,
  UserStatus,
  WornItem,
  type CatalogueCosmetic,
} from "@argon/glue";

// The environment ships no localStorage, and modules these rows import read it on load.
vi.hoisted(() => {
  const entries = new Map<string, string>();

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, String(value));
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
      clear: () => {
        entries.clear();
      },
    },
  });
});

const h = await vi.hoisted(async () => {
  const { defineComponent, h: render } = await import("vue");

  const passThrough = (name: string, props: string[] = []) => defineComponent({
    name,
    props,
    emits: ["update:open"],
    setup: (_props, { slots }) => () => render("div", slots.default?.()),
  });

  return {
    stub: (name: string) => ({ default: defineComponent({ name, setup: () => () => null }) }),
    passThrough,
    getCatalogue: vi.fn(),
    getStatus: vi.fn(),
  };
});

vi.mock("@argon/core", async importOriginal => ({
  ...(await importOriginal<object>()),
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));
vi.mock("@/lib/telemetry/metrics", () => ({ metrics: { count() {} }, errorKind: () => "network" }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    cosmeticsInteraction: {
      GetCatalogue: h.getCatalogue,
      GetMyCosmetics: async () => ({ owned: [] }),
    },
  }),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/store/system/fileStorage", () => ({ cdnUrl: (fileId: string) => `https://cdn.test/${fileId}`, cdnCrossOrigin: () => undefined }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" }, meProfile: null, statusClass: () => "online" }) }));
vi.mock("@/store/data/poolStore", async () => {
  const { computed } = await import("vue");

  return {
    usePoolStore: () => ({
      selectedServer: "s1",
      getUserReactive: () => computed(() => ({ userId: "u1", username: "alice", displayName: "Alice" })),
    }),
  };
});
vi.mock("@/store/data/profileCacheStore", () => ({ useProfileCacheStore: () => ({ getStatus: h.getStatus, revisionOf: () => 0 }) }));
vi.mock("@argon/ui/popover", () => ({
  Popover: h.passThrough("Popover", ["open"]),
  PopoverContent: h.passThrough("PopoverContent", ["collisionPadding"]),
  PopoverTrigger: h.passThrough("PopoverTrigger"),
}));
vi.mock("@/components/ArgonAvatar.vue", () => h.stub("ArgonAvatar"));
vi.mock("@/components/StatusDot.vue", () => h.stub("StatusDot"));
vi.mock("@/components/shared/BotTag.vue", () => h.stub("BotTag"));
vi.mock("@/components/expressions/StatusEmoji.vue", () => h.stub("StatusEmoji"));
vi.mock("@/components/popovers/UserProfilePopover.vue", () => h.stub("UserProfilePopover"));
vi.mock("@/components/modals/ReportDialog.vue", () => h.stub("ReportDialog"));

import FriendListItem from "@/components/home/views/friends/FriendListItem.vue";
import MentionSegment from "@/components/chats/MentionSegment.vue";
import UserInListSideElement from "@/components/UserInListSideElement.vue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { runSessionReset } from "@/store/system/sessionLifecycle";

const BAND_ID = "aaaaaaaa-0000-0000-0000-0000000000f1";

const band: CatalogueCosmetic = {
  cosmeticId: BAND_ID,
  kindKey: "profile.frame",
  slug: "band",
  nameKey: "cosmetic_band",
  descriptionKey: null,
  rarity: null,
  version: 1,
  payload: new PayloadProfileFrame([
    new FrameSurround(
      true,
      100,
      null,
      null,
      AssetSlot.Primary,
      { top: 10, right: 0, bottom: 0, left: 0 } as never,
      { top: 12, right: 0, bottom: 0, left: 0 } as never,
      { top: 24, right: 0, bottom: 0, left: 0 } as never,
      FrameRepeat.Stretch,
      false,
    ),
  ]),
  assets: [{ slot: AssetSlot.Primary, fileId: "band-file" }],
  availableUntil: null,
  free: true,
  ultima: false,
  text: [],
};

const ROOM = { top: 24, right: 0, bottom: 0, left: 0 };
const NO_ROOM = { top: 0, right: 0, bottom: 0, left: 0 };

type Wrapper = ReturnType<typeof mount>;

function roomOf(wrapper: Wrapper) {
  return wrapper.getComponent({ name: "PopoverContent" }).props("collisionPadding");
}

async function setOpen(wrapper: Wrapper, open: boolean) {
  wrapper.getComponent({ name: "Popover" }).vm.$emit("update:open", open);
  await flushPromises();
}

beforeEach(async () => {
  await runSessionReset();

  setActivePinia(createPinia());

  h.getCatalogue.mockReset();
  h.getStatus.mockReset();
  h.getCatalogue.mockResolvedValue({ enabledKinds: ["profile.frame"], items: [band] });
  h.getStatus.mockResolvedValue({ cosmetics: [new WornItem(BAND_ID)] });

  await useCosmeticsStore().ensureLoaded();
});

describe("a member row's card", () => {
  test("keeps clear of the window for a frame even when a frame is the only kind on", async () => {
    const wrapper = mount(UserInListSideElement, {
      props: {
        user: { userId: "u1", username: "alice", displayName: "Alice", avatarFileId: null, flags: 0, status: UserStatus.Online, activity: { kind: 0, titleName: "x" } } as never,
        enablePopup: true,
        showActivity: true,
      },
    });

    await flushPromises();

    expect(h.getStatus).toHaveBeenCalled();
    expect(roomOf(wrapper)).toEqual(ROOM);
  });
});

describe("a mention's card", () => {
  test("keeps the room it opened with while it animates out", async () => {
    const wrapper = mount(MentionSegment, { props: { entity: { userId: "u1" } as never, text: "@alice" } });

    await setOpen(wrapper, true);

    expect(roomOf(wrapper)).toEqual(ROOM);

    await setOpen(wrapper, false);

    expect(roomOf(wrapper)).toEqual(ROOM);
  });

  test("asks for nothing before it is first opened", async () => {
    const wrapper = mount(MentionSegment, { props: { entity: { userId: "u1" } as never, text: "@alice" } });

    await flushPromises();

    expect(h.getStatus).not.toHaveBeenCalled();
    expect(roomOf(wrapper)).toEqual(NO_ROOM);
  });
});

describe("a friend's card", () => {
  test("keeps the room it opened with while it animates out", async () => {
    const wrapper = mount(FriendListItem, { props: { item: { kind: "friend", userId: "u1", displayName: "Alice" } } });

    await setOpen(wrapper, true);

    expect(roomOf(wrapper)).toEqual(ROOM);

    await setOpen(wrapper, false);

    expect(roomOf(wrapper)).toEqual(ROOM);
  });
});
