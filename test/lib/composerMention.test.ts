/**
 * A voice member dropped on a text channel becomes a mention in that channel's composer.
 *
 * The drop and the composer do not know each other: the sidebar (or the chat area) asks for the
 * mention, and whichever composer serves that channel takes it — at once when it is open, or when
 * it mounts, if the drop opened the channel. Taking it too early is the bug worth catching: a
 * composer with text in it no longer takes the channel's draft, and the next autosave would then
 * replace the draft on the server with nothing but the mention.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { IonDateTime } from "@argon-chat/ion.webcore";
import type { MessageDraft } from "@argon/glue";

vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({}) }));

import { pendingMention, requestMention, takeMention, useDroppedMentions } from "@/lib/chat/composerMention";
import { useChannelDraft } from "@/composables/useChannelDraft";
import { parseMessageContent, serializeMessageContent } from "@/lib/chat/parseMessageContent";
import { runSessionReset } from "@/store/system/sessionLifecycle";

/** A composer of `channelId` with the real draft behind it; the server answers when `answer` is called. */
function composer(channelId: string, server: string | null) {
  const text = ref("");
  let answer!: () => void;
  const loaded = new Promise<MessageDraft | null>((resolve) => {
    answer = () => resolve(server === null ? null : { channelId, text: server, entities: [], updatedAt: IonDateTime.now() });
  });

  const Composer = defineComponent({
    setup() {
      const draft = useChannelDraft({
        target: () => ({ spaceId: "s1", channelId }),
        text: () => text.value,
        parse: () => parseMessageContent(text.value, new Map()),
        restore: (d) => { text.value = serializeMessageContent(d.text, d.entities).raw; },
        editing: () => false,
        api: { get: () => loaded, save: async () => {} },
      });
      useDroppedMentions(() => channelId, draft.ready, (userId) => { text.value += `@${userId} `; });
      return () => null;
    },
  });

  const wrapper = mount(Composer);
  return { text, answer, unmount: () => wrapper.unmount() };
}

beforeEach(async () => {
  await runSessionReset();
  pendingMention.value = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the request", () => {
  test("is handed over once, and only to its own channel", () => {
    requestMention("c1", "u1");

    expect(takeMention("c2")).toBeNull();
    expect(takeMention("c1")).toMatchObject({ channelId: "c1", userId: "u1" });
    expect(takeMention("c1")).toBeNull();
  });

  test("goes stale: a channel opened long after the drop does not get it", () => {
    vi.useFakeTimers();
    requestMention("c1", "u1");

    vi.advanceTimersByTime(60_000);

    expect(takeMention("c1")).toBeNull();
  });
});

describe("the composer", () => {
  test("a drop opening the channel lands after the draft, and the draft is kept", async () => {
    requestMention("c1", "u1");
    const c = composer("c1", "half a thought");
    await flushPromises();
    expect(c.text.value).toBe("");

    c.answer();
    await flushPromises();

    expect(c.text.value).toBe("half a thought@u1 ");
    c.unmount();
  });

  test("a drop while the draft is still loading waits for it", async () => {
    const c = composer("c1", "half a thought");
    await flushPromises();

    requestMention("c1", "u1");
    await flushPromises();
    expect(c.text.value).toBe("");

    c.answer();
    await flushPromises();

    expect(c.text.value).toBe("half a thought@u1 ");
    c.unmount();
  });

  test("an open composer takes a drop at once", async () => {
    const c = composer("c1", null);
    c.answer();
    await flushPromises();

    requestMention("c1", "u1");
    await flushPromises();

    expect(c.text.value).toBe("@u1 ");
    expect(pendingMention.value).toBeNull();
    c.unmount();
  });

  test("a drop on another channel is left for that channel's composer", async () => {
    const c = composer("c1", null);
    c.answer();
    await flushPromises();

    requestMention("c2", "u1");
    await flushPromises();

    expect(c.text.value).toBe("");
    expect(pendingMention.value).toMatchObject({ channelId: "c2" });
    c.unmount();
  });
});
