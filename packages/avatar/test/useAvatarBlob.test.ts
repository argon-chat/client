/**
 * Avatar blob resolution.
 *
 * The cache is module-level and shared by every avatar on screen, so the thing worth
 * testing is its key: too coarse and two users share a face, too fine and the app
 * re-fetches the same picture for every message in a chat.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import { useAvatarBlob } from "../src/useAvatarBlob";

const FAILED = "failed://avatar";

function makeStorage() {
  return {
    FAILED_ADDRESS: FAILED,
    fetchUserAvatar: vi.fn(async (fileId: string, ownerId: string) => `user://${ownerId}/${fileId}`),
    fetchServerAvatar: vi.fn(async (fileId: string, ownerId: string) => `server://${ownerId}/${fileId}`),
  };
}

/** Each test needs a cold cache; the module holds it, so re-import per test. */
async function freshModule() {
  vi.resetModules();
  return (await import("../src/useAvatarBlob")).useAvatarBlob;
}

let storage: ReturnType<typeof makeStorage>;

beforeEach(() => {
  storage = makeStorage();
});

describe("resolution", () => {
  test("fetches a user avatar and reports it loaded", async () => {
    const use = await freshModule();
    const r = use(ref("f1"), ref("u1"), "user", storage);

    await vi.waitFor(() => expect(r.loading.value).toBe(false));

    expect(r.blobSrc.value).toBe("user://u1/f1");
    expect(r.loaded.value).toBe(true);
    expect(storage.fetchUserAvatar).toHaveBeenCalledWith("f1", "u1");
  });

  test("server avatars go through the server endpoint", async () => {
    const use = await freshModule();
    const r = use(ref("f1"), ref("s1"), "server", storage);

    await vi.waitFor(() => expect(r.loading.value).toBe(false));

    expect(r.blobSrc.value).toBe("server://s1/f1");
    expect(storage.fetchUserAvatar).not.toHaveBeenCalled();
  });

  test("a missing file or owner resolves to the fallback without a request", async () => {
    const use = await freshModule();

    const noFile = use(ref(null), ref("u1"), "user", storage);
    const noOwner = use(ref("f1"), ref(null), "user", storage);
    await nextTick();

    for (const r of [noFile, noOwner]) {
      expect(r.blobSrc.value).toBe(FAILED);
      expect(r.loaded.value).toBe(false);
      expect(r.loading.value).toBe(false);
    }
    expect(storage.fetchUserAvatar).not.toHaveBeenCalled();
  });

  test("a storage failure is surfaced as not-loaded, not as a broken image", async () => {
    const use = await freshModule();
    storage.fetchUserAvatar = vi.fn(async () => FAILED);

    const r = use(ref("f1"), ref("u1"), "user", storage);
    await vi.waitFor(() => expect(r.loading.value).toBe(false));

    expect(r.loaded.value).toBe(false);
    expect(r.blobSrc.value).toBe(FAILED);
  });

  test("refuses to run without a storage implementation", async () => {
    const use = await freshModule();
    expect(() => use(ref("f1"), ref("u1"), "user")).toThrow(/file storage/i);
  });
});

describe("caching", () => {
  test("the same avatar is fetched once, however many places show it", async () => {
    const use = await freshModule();

    const first = use(ref("f1"), ref("u1"), "user", storage);
    await vi.waitFor(() => expect(first.loading.value).toBe(false));
    const second = use(ref("f1"), ref("u1"), "user", storage);
    await vi.waitFor(() => expect(second.loading.value).toBe(false));

    expect(storage.fetchUserAvatar).toHaveBeenCalledTimes(1);
    expect(second.blobSrc.value).toBe("user://u1/f1");
  });

  test("different owners are never confused for one another", async () => {
    const use = await freshModule();

    const a = use(ref("f1"), ref("u1"), "user", storage);
    await vi.waitFor(() => expect(a.loading.value).toBe(false));
    const b = use(ref("f1"), ref("u2"), "user", storage);
    await vi.waitFor(() => expect(b.loading.value).toBe(false));

    expect(a.blobSrc.value).not.toBe(b.blobSrc.value);
    expect(storage.fetchUserAvatar).toHaveBeenCalledTimes(2);
  });

  test("a user and a server sharing a file id stay separate", async () => {
    const use = await freshModule();

    const user = use(ref("f1"), ref("x"), "user", storage);
    await vi.waitFor(() => expect(user.loading.value).toBe(false));
    const server = use(ref("f1"), ref("x"), "server", storage);
    await vi.waitFor(() => expect(server.loading.value).toBe(false));

    expect(user.blobSrc.value).toBe("user://x/f1");
    expect(server.blobSrc.value).toBe("server://x/f1");
  });

  test("a changed file id refetches — that is how an avatar update shows up", async () => {
    const use = await freshModule();
    const fileId = ref("f1");

    const r = use(fileId, ref("u1"), "user", storage);
    await vi.waitFor(() => expect(r.loading.value).toBe(false));

    fileId.value = "f2";
    await vi.waitFor(() => expect(r.blobSrc.value).toBe("user://u1/f2"));

    expect(storage.fetchUserAvatar).toHaveBeenCalledTimes(2);
  });

  test("a cached failure is not retried on every render", async () => {
    const use = await freshModule();
    storage.fetchUserAvatar = vi.fn(async () => FAILED);

    const first = use(ref("f1"), ref("u1"), "user", storage);
    await vi.waitFor(() => expect(first.loading.value).toBe(false));
    const second = use(ref("f1"), ref("u1"), "user", storage);
    await vi.waitFor(() => expect(second.loading.value).toBe(false));

    expect(storage.fetchUserAvatar).toHaveBeenCalledTimes(1);
    expect(second.loaded.value).toBe(false);
  });
});
