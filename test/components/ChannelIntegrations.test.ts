/**
 * The Integrations tab: the list loads on open, a new webhook's URL is shown once with a copy
 * button, and a new token or a delete goes through a confirmation first.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const h = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  regenerate: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
  writeText: vi.fn(async () => {}),
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    apiEndpoint: "https://api.example.test",
    channelWebhookInteraction: {
      GetWebhooks: h.get,
      CreateWebhook: h.create,
      RenameWebhook: vi.fn(),
      RegenerateWebhookToken: h.regenerate,
      DeleteWebhook: h.remove,
    },
  }),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@argon/core", () => ({
  logger: { warn() {}, info() {}, error() {} },
  cn: (...parts: unknown[]) => parts.flat().filter(Boolean).join(" "),
}));
vi.mock("@argon/ui/dialog", async () => {
  const { defineComponent, h: hh } = await import("vue");
  const pass = (name: string) => defineComponent({ name, setup: (_, { slots }) => () => hh("div", { class: name }, slots.default?.()) });
  return {
    Dialog: defineComponent({
      props: { open: Boolean },
      setup: (p, { slots }) => () => (p.open ? hh("div", { "data-dialog": "" }, slots.default?.()) : null),
    }),
    DialogContent: pass("DialogContent"),
    DialogHeader: pass("DialogHeader"),
    DialogTitle: pass("DialogTitle"),
    DialogDescription: pass("DialogDescription"),
    DialogFooter: pass("DialogFooter"),
  };
});

import { SuccessCreateWebhook } from "@argon/glue";
import ChannelIntegrations from "@/components/settings/channels/ChannelIntegrations.vue";

const date = { toDate: () => new Date(2026, 8, 26) };
const hook = (webhookId: string, name = "Deploys") =>
  ({ webhookId, spaceId: "s1", channelId: "c1", name, avatarFileId: null, creatorId: "u1", createdAt: date, lastUsedAt: null }) as any;
const channel = { spaceId: "s1", channelId: "c1", name: "news", type: 2 } as any;

beforeEach(() => {
  for (const fn of [h.get, h.create, h.regenerate, h.remove, h.toast, h.writeText]) fn.mockReset();
  h.get.mockResolvedValue([]);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: h.writeText }, configurable: true });
});

describe("ChannelIntegrations", () => {
  test("loads the channel's webhooks", async () => {
    h.get.mockResolvedValue([hook("a", "Deploys"), hook("b", "Alerts")]);
    const wrapper = mount(ChannelIntegrations, { props: { channel } });
    await flushPromises();

    expect(h.get).toHaveBeenCalledWith("s1", "c1");
    expect(wrapper.findAll("[data-testid=webhook-row-name]").map((n) => n.text())).toEqual(["Deploys", "Alerts"]);
  });

  test("an empty channel says so", async () => {
    const wrapper = mount(ChannelIntegrations, { props: { channel } });
    await flushPromises();

    expect(wrapper.find("[data-testid=webhooks-empty]").exists()).toBe(true);
  });

  test("creating shows the URL once, with a copy button, until dismissed", async () => {
    h.create.mockResolvedValue(new SuccessCreateWebhook(hook("n", "Deploys"), "tok", "/api/webhooks/n/tok"));
    const wrapper = mount(ChannelIntegrations, { props: { channel } });
    await flushPromises();

    await wrapper.get("[data-testid=webhook-new-name] input, input[data-testid=webhook-new-name]").setValue("Deploys");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(h.create).toHaveBeenCalledWith("s1", "c1", "Deploys");
    const url = wrapper.get("[data-testid=webhook-reveal] input");
    expect((url.element as HTMLInputElement).value).toBe("https://api.example.test/api/webhooks/n/tok");

    await wrapper.get("[data-testid=webhook-copy]").trigger("click");
    await flushPromises();
    expect(h.writeText).toHaveBeenCalledWith("https://api.example.test/api/webhooks/n/tok");

    await wrapper.get("[data-testid=webhook-reveal-done]").trigger("click");
    expect(wrapper.find("[data-testid=webhook-reveal]").exists()).toBe(false);
    expect(wrapper.findAll("[data-testid=webhook-row-name]").map((n) => n.text())).toEqual(["Deploys"]);
  });

  test("deleting asks first", async () => {
    h.get.mockResolvedValue([hook("a")]);
    h.remove.mockResolvedValue(true);
    const wrapper = mount(ChannelIntegrations, { props: { channel } });
    await flushPromises();

    await wrapper.get("[data-testid=webhook-delete]").trigger("click");
    expect(h.remove).not.toHaveBeenCalled();
    expect(wrapper.find("[data-dialog]").exists()).toBe(true);

    await wrapper.get("[data-testid=webhook-confirm]").trigger("click");
    await flushPromises();

    expect(h.remove).toHaveBeenCalledWith("s1", "c1", "a");
    expect(wrapper.find("[data-testid=webhooks-empty]").exists()).toBe(true);
    expect(h.toast).toHaveBeenCalledWith({ title: "webhook_deleted" });
  });

  test("a new URL asks first, then shows it", async () => {
    h.get.mockResolvedValue([hook("a")]);
    h.regenerate.mockResolvedValue(new SuccessCreateWebhook(hook("a"), "tok2", "https://api.argon.gl/api/webhooks/a/tok2"));
    const wrapper = mount(ChannelIntegrations, { props: { channel } });
    await flushPromises();

    await wrapper.get("[data-testid=webhook-regenerate]").trigger("click");
    await wrapper.get("[data-testid=webhook-confirm]").trigger("click");
    await flushPromises();

    expect(h.regenerate).toHaveBeenCalledWith("s1", "c1", "a");
    expect((wrapper.get("[data-testid=webhook-reveal] input").element as HTMLInputElement).value)
      .toBe("https://api.argon.gl/api/webhooks/a/tok2");
  });
});
