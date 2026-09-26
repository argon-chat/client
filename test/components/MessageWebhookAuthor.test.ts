/**
 * A webhook post is sent as the system user but shown as an ordinary message: the webhook's name
 * (or the name the request gave), its avatar when it has one, and a WEBHOOK chip. Consecutive posts
 * group per webhook and name, not per sender, and none of them is a system notice.
 */

import { describe, test, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/chat/userColors", () => ({ useUserColors: () => ({ getColorByUserId: (id: string) => (id === "w1" ? "rgb(1, 2, 3)" : "rgb(9, 9, 9)") }) }));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({ getUserReactive: () => ({ value: null }) }) }));
vi.mock("@/components/ArgonAvatar.vue", () => ({
  default: { name: "ArgonAvatar", props: ["fileId", "fallback"], template: "<img data-avatar :data-file='fileId' />" },
}));

import MessageWebhookAuthor from "@/components/chats/MessageWebhookAuthor.vue";
import { messageAuthorKey } from "@/composables/useMessageGrouping";
import { useMessageContent } from "@/composables/useMessageContent";

const SYSTEM = "11111111-2222-1111-2222-111111111111";
const author = (extra: Record<string, unknown> = {}) => ({ webhookId: "w1", name: "Status page", avatarFileId: null, ...extra });

describe("MessageWebhookAuthor", () => {
  test("the name part shows the webhook's name and the chip", () => {
    const wrapper = mount(MessageWebhookAuthor, { props: { webhook: author(), part: "name" } });

    expect(wrapper.get("[data-testid=webhook-name]").text()).toBe("Status page");
    expect(wrapper.get("[data-testid=webhook-tag]").text()).toBe("webhook_tag");
    expect(wrapper.get("[data-testid=webhook-name]").attributes("style")).toContain("rgb(1, 2, 3)");
  });

  test("the avatar part is the webhook's image when it has one, an icon otherwise", () => {
    const withImage = mount(MessageWebhookAuthor, { props: { webhook: author({ avatarFileId: "f1" }), part: "avatar" } });
    const without = mount(MessageWebhookAuthor, { props: { webhook: author(), part: "avatar" } });

    expect(withImage.find("[data-avatar]").attributes("data-file")).toBe("f1");
    expect(without.find("[data-avatar]").exists()).toBe(false);
    expect(without.find("svg").exists()).toBe(true);
  });
});

describe("webhook posts in the list", () => {
  test("group per webhook and name, not per sender", () => {
    const a = { sender: SYSTEM, webhook: author() };
    const sameHook = { sender: SYSTEM, webhook: author() };
    const renamed = { sender: SYSTEM, webhook: author({ name: "Incident #42" }) };
    const otherHook = { sender: SYSTEM, webhook: author({ webhookId: "w2" }) };
    const system = { sender: SYSTEM, webhook: null };

    expect(messageAuthorKey(a as any)).toBe(messageAuthorKey(sameHook as any));
    expect(messageAuthorKey(a as any)).not.toBe(messageAuthorKey(renamed as any));
    expect(messageAuthorKey(a as any)).not.toBe(messageAuthorKey(otherHook as any));
    expect(messageAuthorKey(system as any)).toBe(SYSTEM);
    expect(messageAuthorKey({ sender: "u1" } as any)).toBe("u1");
  });

  test("are not system notices, though the system user sent them", () => {
    const post = useMessageContent(() => ({ sender: SYSTEM, webhook: author(), entities: [] }) as any);
    const notice = useMessageContent(() => ({ sender: SYSTEM, webhook: null, entities: [] }) as any);

    expect(post.isSystemMessage.value).toBe(false);
    expect(notice.isSystemMessage.value).toBe(true);
  });
});
