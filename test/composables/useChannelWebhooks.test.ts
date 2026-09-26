/**
 * The Integrations tab's logic: a webhook's URL is revealed once (on create and on a new token),
 * made absolute against this client's API when the server answers with a path, and the list follows
 * every change without a reload. Names are checked before the round trip; server refusals come
 * back as a locale key.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";

const h = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  regenerate: vi.fn(),
  remove: vi.fn(),
  apiEndpoint: "https://api.example.test/",
}));

vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    apiEndpoint: h.apiEndpoint,
    channelWebhookInteraction: {
      GetWebhooks: h.get,
      CreateWebhook: h.create,
      RenameWebhook: h.rename,
      RegenerateWebhookToken: h.regenerate,
      DeleteWebhook: h.remove,
    },
  }),
}));

import {
  ChannelWebhookError,
  FailedCreateWebhook,
  FailedUpdateWebhook,
  SuccessCreateWebhook,
  SuccessUpdateWebhook,
  type ChannelWebhook,
} from "@argon/glue";
import {
  MAX_WEBHOOKS_PER_CHANNEL,
  absoluteWebhookUrl,
  useChannelWebhooks,
  validateWebhookName,
  webhookErrorKey,
} from "@/composables/useChannelWebhooks";

const hook = (webhookId: string, name = `hook ${webhookId}`): ChannelWebhook =>
  ({ webhookId, spaceId: "s1", channelId: "c1", name, avatarFileId: null, creatorId: "u1", createdAt: null, lastUsedAt: null }) as any;

const channel = ref({ spaceId: "s1", channelId: "c1" });

beforeEach(() => {
  for (const fn of [h.get, h.create, h.rename, h.regenerate, h.remove]) fn.mockReset();
  h.get.mockResolvedValue([]);
});

describe("validateWebhookName", () => {
  test("trims, refuses empty and more than 32 characters", () => {
    expect(validateWebhookName("  ")).toBe(ChannelWebhookError.NAME_EMPTY);
    expect(validateWebhookName("x".repeat(33))).toBe(ChannelWebhookError.NAME_TOO_LONG);
    expect(validateWebhookName(`  ${"x".repeat(32)}  `)).toBe(ChannelWebhookError.NONE);
  });
});

describe("absoluteWebhookUrl", () => {
  test("keeps an absolute URL and roots a path at the API", () => {
    expect(absoluteWebhookUrl("https://api.argon.gl/api/webhooks/a/b", "https://x")).toBe("https://api.argon.gl/api/webhooks/a/b");
    expect(absoluteWebhookUrl("/api/webhooks/a/b", "https://self.host/")).toBe("https://self.host/api/webhooks/a/b");
  });
});

describe("webhookErrorKey", () => {
  test("maps every refusal to a key and anything else to the generic one", () => {
    expect(webhookErrorKey(ChannelWebhookError.LIMIT_REACHED)).toBe("webhook_error_limit");
    expect(webhookErrorKey(ChannelWebhookError.INSUFFICIENT_PERMISSIONS)).toBe("webhook_error_permissions");
    expect(webhookErrorKey(ChannelWebhookError.WEBHOOK_NOT_FOUND)).toBe("webhook_error_not_found");
    expect(webhookErrorKey(ChannelWebhookError.NONE)).toBe("webhook_error_generic");
  });

  test("a reserved name is explained as such, not as a generic failure", async () => {
    expect(webhookErrorKey(ChannelWebhookError.NAME_NOT_ALLOWED)).toBe("webhook_error_name_not_allowed");

    h.create.mockResolvedValue(new FailedCreateWebhook(ChannelWebhookError.NAME_NOT_ALLOWED));
    expect(await useChannelWebhooks(channel).create("Argon")).toEqual({ ok: false, errorKey: "webhook_error_name_not_allowed" });
  });
});

describe("useChannelWebhooks", () => {
  test("loads the list", async () => {
    h.get.mockResolvedValue([hook("a"), hook("b")]);
    const w = useChannelWebhooks(channel);

    expect(await w.load()).toBe(true);
    expect(h.get).toHaveBeenCalledWith("s1", "c1");
    expect(w.webhooks.value.map((x) => x.webhookId)).toEqual(["a", "b"]);
  });

  test("creating adds the webhook and reveals its URL once, made absolute", async () => {
    h.create.mockResolvedValue(new SuccessCreateWebhook(hook("new", "Deploys"), "tok", "/api/webhooks/new/tok"));
    const w = useChannelWebhooks(channel);

    const outcome = await w.create("  Deploys ");

    expect(outcome).toEqual({ ok: true });
    expect(h.create).toHaveBeenCalledWith("s1", "c1", "Deploys");
    expect(w.webhooks.value.map((x) => x.webhookId)).toEqual(["new"]);
    expect(w.revealed.value).toEqual({ webhookId: "new", name: "Deploys", url: "https://api.example.test/api/webhooks/new/tok" });

    w.dismissReveal();
    expect(w.revealed.value).toBeNull();
  });

  test("a bad name or a full channel never reaches the server", async () => {
    h.get.mockResolvedValue(Array.from({ length: MAX_WEBHOOKS_PER_CHANNEL }, (_, i) => hook(String(i))));
    const w = useChannelWebhooks(channel);

    expect(await w.create(" ")).toEqual({ ok: false, errorKey: "webhook_error_name_empty" });

    await w.load();
    expect(w.atLimit.value).toBe(true);
    expect(await w.create("eleventh")).toEqual({ ok: false, errorKey: "webhook_error_limit" });
    expect(h.create).not.toHaveBeenCalled();
  });

  test("a refusal comes back as its key and reveals nothing", async () => {
    h.create.mockResolvedValue(new FailedCreateWebhook(ChannelWebhookError.INSUFFICIENT_PERMISSIONS));
    const w = useChannelWebhooks(channel);

    expect(await w.create("hook")).toEqual({ ok: false, errorKey: "webhook_error_permissions" });
    expect(w.revealed.value).toBeNull();
    expect(w.webhooks.value).toEqual([]);
  });

  test("a thrown call is a generic failure and frees the form", async () => {
    h.create.mockRejectedValue(new Error("network"));
    const w = useChannelWebhooks(channel);

    expect(await w.create("hook")).toEqual({ ok: false, errorKey: "webhook_error_generic" });
    expect(w.busy.value).toBe(false);
  });

  test("renaming replaces the row in place", async () => {
    h.get.mockResolvedValue([hook("a", "old"), hook("b")]);
    h.rename.mockResolvedValue(new SuccessUpdateWebhook(hook("a", "new")));
    const w = useChannelWebhooks(channel);
    await w.load();

    expect(await w.rename("a", " new ")).toEqual({ ok: true });
    expect(h.rename).toHaveBeenCalledWith("s1", "c1", "a", "new");
    expect(w.webhooks.value.map((x) => x.name)).toEqual(["new", "hook b"]);

    h.rename.mockResolvedValue(new FailedUpdateWebhook(ChannelWebhookError.WEBHOOK_NOT_FOUND));
    expect(await w.rename("a", "again")).toEqual({ ok: false, errorKey: "webhook_error_not_found" });
  });

  test("a new token reveals the new URL for the same webhook", async () => {
    h.get.mockResolvedValue([hook("a", "feed")]);
    h.regenerate.mockResolvedValue(new SuccessCreateWebhook(hook("a", "feed"), "tok2", "https://api.argon.gl/api/webhooks/a/tok2"));
    const w = useChannelWebhooks(channel);
    await w.load();

    expect(await w.regenerate("a")).toEqual({ ok: true });
    expect(w.webhooks.value).toHaveLength(1);
    expect(w.revealed.value?.url).toBe("https://api.argon.gl/api/webhooks/a/tok2");
  });

  test("deleting removes the row and a revealed URL of it", async () => {
    h.create.mockResolvedValue(new SuccessCreateWebhook(hook("a"), "tok", "/api/webhooks/a/tok"));
    h.remove.mockResolvedValue(true);
    const w = useChannelWebhooks(channel);
    await w.create("a");

    expect(await w.remove("a")).toEqual({ ok: true });
    expect(h.remove).toHaveBeenCalledWith("s1", "c1", "a");
    expect(w.webhooks.value).toEqual([]);
    expect(w.revealed.value).toBeNull();
  });

  test("one change at a time", async () => {
    let finish!: (v: unknown) => void;
    h.create.mockReturnValue(new Promise((r) => (finish = r)));
    const w = useChannelWebhooks(channel);

    const first = w.create("one");
    expect(await w.create("two")).toEqual({ ok: false, errorKey: "webhook_error_generic" });
    finish(new SuccessCreateWebhook(hook("one"), "t", "/x"));
    expect(await first).toEqual({ ok: true });
    expect(h.create).toHaveBeenCalledTimes(1);
  });
});
