/**
 * How the flag store treats a key it was not born knowing.
 *
 * Every flag in this client is a declared key with a default, and that is right for flags that gate
 * parts of this client: one it does not declare is one nothing reads. Cosmetic kill switches are the
 * exception — the server decides which kinds exist, so a build can meet a flag for a kind it has
 * never heard of — and they are matched by prefix instead.
 *
 * The guard used to be written out twice, once in the loader and once in the live event handler, and
 * the two are easy to change apart: a flag accepted at boot and ignored when it changes is a kill
 * switch that works until somebody actually uses it. Both paths are pinned here for that reason.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

let serverFlags: Array<{ flagId: string; isEnabled: boolean }> = [];
let activated: ((event: { flagId: string; isEnabled: boolean; variant: string | null }) => void) | null = null;

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    featureFlagInteraction: {
      GetMyFeatureFlags: async () => serverFlags,
    },
  }),
}));
vi.mock("@/store/realtime/busStore", () => ({
  useBus: () => ({
    onServerEvent: (_key: string, cb: typeof activated) => {
      activated = cb;
      return { unsubscribe() {} };
    },
  }),
}));
vi.mock("@/store/system/sessionLifecycle", () => ({
  onSessionReset: () => {},
}));

import { cosmeticFlagKeyFor, FeatureFlagKeys, useFeatureFlags } from "@/store/features/featureFlagsStore";

describe("cosmetic kill switches", () => {
  beforeEach(() => {
    serverFlags = [];
    activated = null;
    setActivePinia(createPinia());
  });

  test("a kind key becomes the flag the server writes", () => {
    expect(cosmeticFlagKeyFor("profile.background")).toBe("af.cosmetics.profile-background.active");
    expect(cosmeticFlagKeyFor("avatar.decoration")).toBe("af.cosmetics.avatar-decoration.active");
  });

  /**
   * Absence means enabled. A kind exists because a file in the build declares it, and requiring a
   * database row as well is how a feature ends up live, correct, and invisible.
   */
  test("a kind nobody has switched is on", () => {
    const flags = useFeatureFlags();

    expect(flags.isCosmeticKindEnabled("profile.badge")).toBe(true);
  });

  test("a declared flag still loads as before", async () => {
    serverFlags = [{ flagId: FeatureFlagKeys.ULTIMA_ACTIVE, isEnabled: true }];

    const flags = useFeatureFlags();
    await flags.loadFeatureFlags();

    expect(flags.isEnabled(FeatureFlagKeys.ULTIMA_ACTIVE)).toBe(true);
  });

  test("a cosmetic flag is taken at boot even though nothing declares it", async () => {
    serverFlags = [{ flagId: "af.cosmetics.profile-badge.active", isEnabled: false }];

    const flags = useFeatureFlags();
    await flags.loadFeatureFlags();

    expect(flags.isCosmeticKindEnabled("profile.badge")).toBe(false);
    expect(flags.isCosmeticKindEnabled("profile.background")).toBe(true);
  });

  test("and when it changes while the app is open", () => {
    const flags = useFeatureFlags();
    flags.subscribeToEvents();

    expect(activated).not.toBeNull();

    activated!({ flagId: "af.cosmetics.nickname-style.active", isEnabled: false, variant: null });

    expect(flags.isCosmeticKindEnabled("nickname.style")).toBe(false);

    activated!({ flagId: "af.cosmetics.nickname-style.active", isEnabled: true, variant: null });

    expect(flags.isCosmeticKindEnabled("nickname.style")).toBe(true);
  });

  /**
   * The passthrough is a prefix, not an opening: a flag that is neither declared nor a cosmetic kill
   * switch is still ignored, so the declared set keeps meaning something.
   */
  test("an undeclared flag that is not a cosmetic one is still ignored", async () => {
    serverFlags = [{ flagId: "af.some.other.thing", isEnabled: true }];

    const flags = useFeatureFlags();
    await flags.loadFeatureFlags();

    expect("af.some.other.thing" in flags.flags).toBe(false);
    expect("af.some.other.thing" in flags.cosmeticFlags).toBe(false);
  });
});
