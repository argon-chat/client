/**
 * The caller's own look comes from `meProfile`, which an equip replaces at once; anybody else's from
 * the row the surface already holds.
 */

import {
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  reactive,
  ref,
} from "vue";

const h = vi.hoisted(() => ({
  me: null as unknown as { me: { userId: string } | null; meProfile: { cosmetics: unknown[] } | null },
}));

vi.mock("@/store/auth/meStore", () => ({ useMe: () => h.me }));

import { useWornProfile } from "@/composables/useWornProfile";

const held = { cosmetics: [{ UnionKey: "WornItem", itemId: "held" }] } as never;

describe("what somebody is drawn wearing", () => {
  test("the caller's own look is meProfile, not the row a surface holds", () => {
    h.me = reactive({ me: { userId: "me" }, meProfile: { cosmetics: [] } });

    const worn = useWornProfile("me", held);

    expect(worn.value).toBe(h.me.meProfile);
  });

  test("follows an equip without the row asking again", () => {
    h.me = reactive({ me: { userId: "me" }, meProfile: { cosmetics: [] } });

    const worn = useWornProfile("me", held);
    const equipped = { cosmetics: [{ UnionKey: "WornItem", itemId: "new" }] };

    h.me.meProfile = equipped;

    expect(worn.value).toStrictEqual(equipped);
  });

  test("anybody else is drawn from the held row", () => {
    h.me = reactive({ me: { userId: "me" }, meProfile: { cosmetics: [] } });

    expect(useWornProfile("alice", held).value).toBe(held);
  });

  test("the caller's own row is used until meProfile has loaded", () => {
    h.me = reactive({ me: { userId: "me" }, meProfile: null });

    expect(useWornProfile("me", held).value).toBe(held);
  });

  test("nothing held draws nothing", () => {
    h.me = reactive({ me: null, meProfile: null });

    const person = ref<string | null>(null);

    expect(useWornProfile(person, null).value).toBeNull();
  });
});
