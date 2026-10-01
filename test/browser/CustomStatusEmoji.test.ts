/**
 * Custom emoji in custom statuses, in a real browser. The status editor in the profile settings has
 * an emoji button in the field's left that opens the emoji picker over every loaded space; a custom
 * pick shows in the button and in the preview card and is saved as `ce:<itemId>`, a unicode pick as
 * the emoji itself, and × clears it (sent as ""). A refused icon says why. A member-list row draws a
 * custom status emoji through StickerView before the text and stays one line; it holds its first
 * frame and plays only while the row is hovered (the preview card plays it always).
 */

import "../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { page, userEvent } from "vitest/browser";
import { createPinia, setActivePinia } from "pinia";
import { initializeEmojix } from "@argon-chat/emojix";
import {
  ExpressionFormat,
  ExpressionKind,
  UpdateMeError,
  UserStatus,
  type ArgonUserProfile,
  type ExpressionItem,
  type ExpressionPack,
  type StatusEmoji,
  type UserEditInput,
} from "@argon/glue";

const h = await vi.hoisted(async () => {
  const { defineComponent, reactive, ref } = await import("vue");
  const stub = (name: string) => ({ default: defineComponent({ name, setup: () => () => null }) });
  return {
    stub,
    ref,
    toast: vi.fn(),
    updateMe: vi.fn(),
    getStatus: vi.fn(),
    me: reactive({
      me: { userId: "me", username: "me", displayName: "Me", avatarFileId: null, flags: 0 },
      meProfile: null as unknown as ArgonUserProfile,
      isPremium: true,
      statusClass: () => "online",
    }),
  };
});

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    userInteraction: { UpdateMe: h.updateMe },
    securityInteraction: {
      GetSecurityDetails: async () => ({
        otpEnabled: false,
        passkeys: [],
        autoDeletePeriod: { enabled: false, months: null },
        email: null,
        phone: null,
      }),
    },
    spaceExpressionInteraction: {
      // `known` matched: the seeded copy is current.
      GetExpressions: async (_spaceId: string, known: string | null) => ({ version: known ?? "v1", packs: null }),
    },
  }),
}));
vi.mock("@/store/system/fileStorage", async () => {
  const { default: url } = await import("./fixtures/tiny-lottie.json?url");
  return { cdnUrl: () => url, cdnFetchUrl: () => url, cdnCrossOrigin: () => undefined };
});
vi.mock("@/store/auth/meStore", () => ({ useMe: () => h.me }));
vi.mock("@/store/realtime/busStore", () => ({ useBus: () => ({ onServerEvent: () => ({ unsubscribe() {} }) }) }));
vi.mock("@argon/passkey", () => ({ PasskeyManager: class {} }));
vi.mock("@/store/features/featureFlagsStore", () => ({
  useFeatureFlags: () => ({ passkeyActive: h.ref(false), autoDeleteAccountActive: h.ref(false), ultimaActive: h.ref(true) }),
}));
vi.mock("@/store/data/ultimaStore", () => ({
  useUltimaStore: () => ({ pricing: null, fetchSubscription() {}, createCheckout: async () => ({ success: false }) }),
}));
vi.mock("@/lib/uploadFile", () => ({ uploadFile: async () => ({ blobId: "b" }) }));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({ selectedServer: "s1" }) }));
vi.mock("@/store/data/profileCacheStore", () => ({ useProfileCacheStore: () => ({ getStatus: h.getStatus }) }));
vi.mock("@/components/settings/AvatarCropDialog.vue", () => h.stub("AvatarCropDialog"));
vi.mock("@/components/settings/ActiveSessions.vue", () => h.stub("ActiveSessions"));
vi.mock("@/components/modals/UltimaCheckoutDialog.vue", () => h.stub("UltimaCheckoutDialog"));
vi.mock("@/components/login/QRStyled.vue", () => h.stub("QRStyled"));
vi.mock("@/components/ArgonAvatar.vue", () => h.stub("ArgonAvatar"));
vi.mock("@/components/popovers/UserProfilePopover.vue", () => h.stub("UserProfilePopover"));
vi.mock("@/components/modals/ReportDialog.vue", () => h.stub("ReportDialog"));

import ProfileSettings from "@/components/settings/ProfileSettings.vue";
import UserInListSideElement from "@/components/UserInListSideElement.vue";
import StickerView from "@/components/expressions/StickerView.vue";
import { getLottiePool, type LottiePlayerHandle } from "@/lib/expressions/lottie/LottiePool";
import { useExpressionsStore } from "@/store/data/expressionsStore";
import { db } from "@/store/db/dexie";

const item = (spaceId: string, itemId: string, packId: string, sortOrder: number): ExpressionItem => ({
  itemId,
  packId,
  spaceId,
  kind: ExpressionKind.Emoji,
  format: ExpressionFormat.Lottie,
  name: itemId.replace(/-/g, "_"),
  fileId: `file-${itemId}`,
  thumbFileId: null,
  width: 100,
  height: 100,
  fileSize: 1000,
  emoji: [],
  keywords: [],
  outline: null,
  textColor: false,
  sortOrder,
  downloadUrl: null,
  thumbUrl: null,
  creatorId: null,
});

const emojiPack = (spaceId: string, packId: string, count: number): ExpressionPack => ({
  packId,
  spaceId,
  kind: ExpressionKind.Emoji,
  title: packId,
  slug: packId,
  coverItemId: null,
  sortOrder: 0,
  version: 1n,
  items: Array.from({ length: count }, (_, i) => item(spaceId, `${packId}-${i}`, packId, i)),
  creatorId: null,
});

const statusEmojiOf = (i: ExpressionItem): StatusEmoji => ({ itemId: i.itemId, spaceId: i.spaceId, fileId: i.fileId, format: i.format, name: i.name });

const profile = (customStatus: string | null, customStatusIconId: string | null, customStatusEmoji: StatusEmoji | null = null): ArgonUserProfile => ({
  userId: "me",
  customStatus,
  customStatusIconId,
  bannerFileID: null,
  dateOfBirth: null,
  bio: null,
  badges: [],
  archetypes: [],
  backgroundId: null,
  voiceCardEffectId: null,
  avatarFrameId: null,
  nickEffectId: null,
  primaryColor: null,
  accentColor: null,
  registeredAt: null,
  cosmetics: null,
  customStatusEmoji,
  connections: null,
});

/** What UserGrain.UpdateProfileAsync does with the status half of an edit. */
function serverApplies(input: UserEditInput, before: ArgonUserProfile, items: ExpressionItem[]): ArgonUserProfile {
  const after = { ...before };
  if (input.customStatus !== null) after.customStatus = input.customStatus;
  if (input.customStatusIconId !== null || input.customStatus === "") {
    const iconId = input.customStatusIconId || null;
    const custom = iconId?.startsWith("ce:") ? items.find((i) => `ce:${i.itemId}` === iconId) : undefined;
    after.customStatusIconId = iconId;
    after.customStatusEmoji = custom ? statusEmojiOf(custom) : null;
  }
  return after;
}

const s1 = emojiPack("s1", "blobs", 3);
const s2 = emojiPack("s2", "parrots", 2);

const mounted: VueWrapper[] = [];

async function until(check: () => boolean, timeout = 5_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector);
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;

function settings() {
  const wrapper = mount(ProfileSettings, { attachTo: document.body });
  mounted.push(wrapper);
  return wrapper;
}

async function openStatusPicker() {
  await userEvent.click($("[data-testid=status-emoji-button]")!);
  await until(() => !!$("[data-testid=status-emoji-picker] .xp-cell"));
}

/** The StickerView under `selector`, as a component, to read what it was given. */
function stickerUnder(wrapper: VueWrapper, selector: string) {
  return wrapper.findAllComponents(StickerView).find((c) => !!(c.element as Element).closest?.(selector));
}

beforeAll(async () => {
  await initializeEmojix();
  await page.viewport(1400, 1000);
});

beforeEach(async () => {
  localStorage.clear();
  setActivePinia(createPinia());
  await db.servers.clear();
  const store = useExpressionsStore();
  store.bySpace.set("s1", { version: "v1", packs: [s1], loadedAt: Date.now() });
  store.bySpace.set("s2", { version: "v1", packs: [s2], loadedAt: Date.now() });
  h.me.meProfile = profile("at work", null);
  h.me.isPremium = true;
  h.toast.mockReset();
  h.getStatus.mockReset();
  h.updateMe.mockReset();
  h.updateMe.mockImplementation(async (input: UserEditInput) => ({
    isSuccessUpdateMe: () => true,
    isFailedUpdateMe: () => false,
    user: h.me.me,
    profile: serverApplies(input, h.me.meProfile, [...s1.items, ...s2.items]),
  }));
});

afterEach(async () => {
  for (const w of mounted.splice(0)) w.unmount();
  await flushPromises();
  document.body.innerHTML = "";
});

describe("the custom status editor", () => {
  test("the emoji button opens the emoji picker over every space; a custom pick shows in the button and the preview and is saved as ce:<itemId>", async () => {
    const wrapper = settings();
    // The editor fills in from the profile once the pane has loaded.
    await until(() => $("[data-testid=preview-custom-status]")?.textContent?.trim() === "at work");
    expect($("[data-testid=status-emoji-button] [data-status-emoji]")).toBeNull();

    await openStatusPicker();
    const picker = $("[data-testid=status-emoji-picker]")!;
    expect([...picker.querySelectorAll<HTMLElement>(".xp-tabs__tab")].map((b) => b.dataset.tab)).toEqual(["emoji"]);
    expect($('[data-group-id="space:s1"]', picker)).not.toBeNull();
    expect($('[data-group-id="space:s2"]', picker)).not.toBeNull();

    const parrot = s2.items[1];
    await userEvent.click($(`[data-group-id="space:s2"] .xp-cell--custom[aria-label=":${parrot.name}:"]`, picker)!);
    await until(() => !$("[data-testid=status-emoji-picker]"));

    expect(stickerUnder(wrapper, "[data-testid=status-emoji-button]")?.props("media")).toMatchObject({ fileId: parrot.fileId });
    const preview = stickerUnder(wrapper, "[data-testid=preview-custom-status]");
    expect(preview?.props("media")).toMatchObject({ fileId: parrot.fileId, width: 100, height: 100 });
    expect(preview?.props("group")).toBe("status");
    expect(preview?.props("autoplay")).toBe(true);
    expect($("[data-testid=preview-custom-status]")?.textContent?.trim()).toBe("at work");

    await userEvent.click(button("save_changes"));
    await until(() => h.updateMe.mock.calls.length > 0);
    expect(h.updateMe.mock.calls[0][0]).toMatchObject({ customStatus: null, customStatusIconId: `ce:${parrot.itemId}` });
    await until(() => h.me.meProfile.customStatusIconId === `ce:${parrot.itemId}`);
    expect(h.me.meProfile.customStatusEmoji).toEqual(statusEmojiOf(parrot));
  });

  test("a unicode pick is the emoji itself; × takes it off, and an emptied status is sent as \"\" (it used to be sent as 'unchanged')", async () => {
    h.me.meProfile = profile("at work", "☕");
    settings();
    await until(() => !!$("[data-testid=status-emoji-button] [data-status-emoji=unicode]"));
    expect($("[data-testid=status-emoji-button] [data-status-emoji=unicode]")?.textContent?.trim()).toBe("☕");

    await openStatusPicker();
    const cell = $<HTMLElement>('[data-testid=status-emoji-picker] [data-group-id="smileys"] .xp-cell--unicode')!;
    await userEvent.click(cell);
    await until(() => !$("[data-testid=status-emoji-picker]"));
    const picked = $("[data-testid=status-emoji-button] [data-status-emoji=unicode]")!;
    expect(picked.textContent?.trim()).not.toBe("☕");
    // Drawn from the sprite atlas, as in messages.
    expect(picked.querySelector(".msg-emoji")).not.toBeNull();
    expect($("[data-testid=preview-custom-status] [data-status-emoji=unicode]")?.textContent).toBe(picked.textContent);

    await userEvent.click($("[data-testid=status-emoji-clear]")!);
    await nextTick();
    expect($("[data-testid=status-emoji-button] [data-status-emoji]")).toBeNull();
    expect($("[data-testid=preview-custom-status] [data-status-emoji]")).toBeNull();

    await userEvent.clear($<HTMLInputElement>("#profile-custom-status")!);
    await nextTick();
    expect($("[data-testid=preview-custom-status]")).toBeNull();

    await userEvent.click(button("save_changes"));
    await until(() => h.updateMe.mock.calls.length > 0);
    expect(h.updateMe.mock.calls[0][0]).toMatchObject({ customStatus: "", customStatusIconId: "" });
  });

  test("a refused icon says why", async () => {
    h.updateMe.mockImplementation(async () => ({
      isSuccessUpdateMe: () => false,
      isFailedUpdateMe: () => true,
      error: UpdateMeError.INVALID_STATUS_EMOJI,
    }));
    settings();
    await openStatusPicker();
    await userEvent.click($('[data-testid=status-emoji-picker] [data-group-id="space:s1"] .xp-cell--custom')!);
    await until(() => !$("[data-testid=status-emoji-picker]"));

    await userEvent.click(button("save_changes"));
    await until(() => h.toast.mock.calls.length > 0);
    expect(h.toast.mock.calls[0][0]).toMatchObject({ description: "status_emoji_invalid", variant: "destructive" });
  });
});

describe("a member-list row", () => {
  const user = { userId: "u1", username: "alice", displayName: "Alice", avatarFileId: null, flags: 0, status: UserStatus.Online } as never;

  function row() {
    const box = document.createElement("div");
    box.style.width = "220px";
    document.body.appendChild(box);
    const wrapper = mount(UserInListSideElement, { props: { user, enablePopup: false }, attachTo: box });
    mounted.push(wrapper);
    return wrapper;
  }

  test("draws a custom status emoji through StickerView before the text, on one line", async () => {
    const parrot = s2.items[0];
    h.getStatus.mockResolvedValue({
      customStatus: "reviewing the very long list of things that do not fit on one line",
      customStatusIconId: `ce:${parrot.itemId}`,
      customStatusEmoji: statusEmojiOf(parrot),
    });
    const wrapper = row();
    await until(() => !!$("[data-testid=member-custom-status] .sticker-view"));

    const status = $("[data-testid=member-custom-status]")!;
    expect(status.firstElementChild?.classList.contains("sticker-view")).toBe(true);
    const sticker = stickerUnder(wrapper, "[data-testid=member-custom-status]")!;
    expect(sticker.props()).toMatchObject({ media: { fileId: parrot.fileId }, size: 14, loop: true, group: "status" });
    await until(() => (sticker.element as HTMLElement).dataset.phase === "ready");

    const label = $(".user-status-label", status)!;
    expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
    expect(status.getBoundingClientRect().height).toBeLessThanOrEqual(18);
    expect(Math.abs(sticker.element.getBoundingClientRect().top - status.getBoundingClientRect().top)).toBeLessThanOrEqual(3);
  });

  test("the status emoji holds its first frame until the row is hovered, and plays only while it is", async () => {
    const parrot = s2.items[1];
    h.getStatus.mockResolvedValue({ customStatus: "busy", customStatusIconId: `ce:${parrot.itemId}`, customStatusEmoji: statusEmojiOf(parrot) });
    const create = vi.spyOn(getLottiePool(), "createPlayer");
    const wrapper = row();
    await until(() => create.mock.results.length > 0);
    const player = create.mock.results[0].value as LottiePlayerHandle;
    const sticker = stickerUnder(wrapper, "[data-testid=member-custom-status]")!;
    await until(() => (sticker.element as HTMLElement).dataset.phase === "ready");

    expect(sticker.props("autoplay")).toBe(false);
    expect(player.playing).toBe(false);

    const rowEl = $(".user-element")!;
    await userEvent.hover(rowEl);
    await until(() => player.playing);
    expect(sticker.props("autoplay")).toBe(true);

    await userEvent.unhover(rowEl);
    await until(() => !player.playing);
    expect(sticker.props("autoplay")).toBe(false);
  });

  test("an emoji alone is a status too; a unicode one is the sprite", async () => {
    h.getStatus.mockResolvedValue({ customStatus: "", customStatusIconId: "🍕", customStatusEmoji: null });
    row();
    await until(() => !!$("[data-testid=member-custom-status] [data-status-emoji=unicode]"));
    expect($("[data-testid=member-custom-status] .msg-emoji")).not.toBeNull();
    expect($("[data-testid=member-custom-status] .user-status-label")).toBeNull();
  });

  test("no text and no icon: no status line", async () => {
    h.getStatus.mockResolvedValue({ customStatus: "", customStatusIconId: null, customStatusEmoji: null });
    row();
    await flushPromises();
    await nextTick();
    expect($("[data-testid=member-custom-status]")).toBeNull();
  });
});
