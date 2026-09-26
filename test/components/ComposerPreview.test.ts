/**
 * The composer's preview shows the message the way the chat will: the text goes through the same
 * parser a send uses, and the result through the fragments and segments a message is drawn with.
 */

import { describe, test, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
// fragmentMessageText lives beside a composable that reads the pool; the preview never touches it.
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({}) }));
vi.mock("@/components/chats/MentionSegment.vue", async () => {
  const { h } = await import("vue");
  return {
    default: {
      name: "MentionSegment",
      props: ["entity", "text"],
      setup: (props: { text: string }) => () => h("span", { class: "stub-mention" }, props.text),
    },
  };
});

import ComposerPreview from "@/components/chats/ComposerPreview.vue";
import { parseMessageContent } from "@/lib/chat/parseMessageContent";

function preview(raw: string, mentions = new Map<string, string>()) {
  return mount(ComposerPreview, { props: { content: parseMessageContent(raw, mentions) } });
}

describe("the composer preview", () => {
  test("markers become the formatting a sent message gets, and disappear from the text", () => {
    const w = preview("**loud** and __soft__ with `code`");
    const body = w.find('[data-testid="composer-preview-body"]');

    expect(body.text()).toBe("loud and soft with code");
    expect(body.find(".font-bold").text()).toBe("loud");
    expect(body.find(".italic").text()).toBe("soft");
    expect(body.find(".font-mono").text()).toBe("code");
  });

  test("a picked mention is drawn by the mention segment", () => {
    const w = preview("hi @Anna", new Map([["@Anna", "u-anna"]]));

    expect(w.find(".stub-mention").text()).toBe("@Anna");
  });

  test("plain text is shown as it is", () => {
    const w = preview("just words");

    expect(w.find('[data-testid="composer-preview-body"]').text()).toBe("just words");
    expect(w.find(".font-bold").exists()).toBe(false);
  });

  test("nothing to show says so", () => {
    const w = preview("");

    expect(w.find('[data-testid="composer-preview-body"]').exists()).toBe(false);
    expect(w.text()).toContain("composer_preview_empty");
  });
});
