/**
 * The server-side draft of a channel composer.
 *
 * An empty composer takes the channel's draft when it opens; typing saves it a moment after the
 * last keystroke; a send or a schedule deletes it. Editing a sent message borrows the composer, so
 * nothing is saved while it does. Leaving the channel (the composer is keyed by channel, so that
 * unmounts it) sends a pending save at once, and the composer opened next reads after it.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { EntityType, MessageEntityBold, type IMessageEntity, type MessageDraft } from "@argon/glue";
import { IonDateTime } from "@argon-chat/ion.webcore";

vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({}) }));

import { useChannelDraft, type DraftApi, type DraftTarget } from "@/composables/useChannelDraft";
import { parseMessageContent, serializeMessageContent } from "@/lib/chat/parseMessageContent";

interface Harness {
  text: ReturnType<typeof ref<string>>;
  editing: ReturnType<typeof ref<boolean>>;
  api: { get: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  draft: ReturnType<typeof useChannelDraft>;
  unmount: () => void;
}

function draftOf(text: string, entities: IMessageEntity[] = [], channelId = "c1"): MessageDraft {
  return { channelId, text, entities, updatedAt: IonDateTime.now() };
}

function open(options: {
  initialText?: string;
  target?: DraftTarget | null;
  server?: MessageDraft | null;
  api?: Partial<DraftApi>;
} = {}): Harness {
  const text = ref(options.initialText ?? "");
  const editing = ref(false);
  const api = {
    get: vi.fn(options.api?.get ?? (async () => options.server ?? null)),
    save: vi.fn(options.api?.save ?? (async () => {})),
  };
  let draft!: ReturnType<typeof useChannelDraft>;

  const Composer = defineComponent({
    setup() {
      draft = useChannelDraft({
        target: () => (options.target === undefined ? { spaceId: "s1", channelId: "c1" } : options.target),
        text: () => text.value!,
        parse: () => parseMessageContent(text.value!, new Map()),
        restore: (d) => {
          text.value = serializeMessageContent(d.text, d.entities).raw;
        },
        editing: () => editing.value!,
        api,
      });
      return () => null;
    },
  });

  const wrapper = mount(Composer);
  return { text, editing, api, draft, unmount: () => wrapper.unmount() };
}

async function type(h: Harness, value: string) {
  h.text.value = value;
  await nextTick();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("opening a channel", () => {
  test("an empty composer takes the draft, with its formatting, and does not save it back", async () => {
    const h = open({ server: draftOf("hello world", [new MessageEntityBold(EntityType.Bold, 6, 5, 1)]) });
    await flushPromises();

    expect(h.api.get).toHaveBeenCalledWith("s1", "c1");
    expect(h.text.value).toBe("hello **world**");

    await vi.advanceTimersByTimeAsync(5000);
    expect(h.api.save).not.toHaveBeenCalled();
    h.unmount();
  });

  test("a composer that already holds text keeps it", async () => {
    const h = open({ initialText: "typed first", server: draftOf("stored") });
    await flushPromises();

    expect(h.api.get).not.toHaveBeenCalled();
    expect(h.text.value).toBe("typed first");
    h.unmount();
  });

  test("text typed while the draft loads is not overwritten", async () => {
    let answer!: (d: MessageDraft) => void;
    const h = open({ api: { get: () => new Promise<MessageDraft>((r) => (answer = r)) } });

    await type(h, "quick");
    answer(draftOf("stored"));
    await flushPromises();

    expect(h.text.value).toBe("quick");
    h.unmount();
  });

  test("a direct chat or a caption has no draft at all", async () => {
    const h = open({ target: null, server: draftOf("stored") });
    await flushPromises();
    await type(h, "hi");
    await vi.advanceTimersByTimeAsync(5000);

    expect(h.api.get).not.toHaveBeenCalled();
    expect(h.api.save).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe("autosave", () => {
  test("saves once, a second and a half after the last keystroke, as parsed", async () => {
    const h = open();
    await flushPromises();

    await type(h, "**he**");
    await vi.advanceTimersByTimeAsync(1000);
    await type(h, "**hey**");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.api.save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);
    expect(h.api.save).toHaveBeenCalledTimes(1);
    const [spaceId, channelId, text, entities] = h.api.save.mock.calls[0];
    expect([spaceId, channelId, text]).toEqual(["s1", "c1", "hey"]);
    expect(entities).toEqual([new MessageEntityBold(EntityType.Bold, 0, 3, 1)]);
    h.unmount();
  });

  test("text over the limit is not saved", async () => {
    const h = open();
    await flushPromises();

    await type(h, "a".repeat(5000));
    await vi.advanceTimersByTimeAsync(2000);

    expect(h.api.save).not.toHaveBeenCalled();
    h.unmount();
  });

  test("emptying the composer deletes a draft the server has", async () => {
    const h = open({ server: draftOf("stored") });
    await flushPromises();

    await type(h, "");
    await vi.advanceTimersByTimeAsync(2000);

    expect(h.api.save).toHaveBeenCalledWith("s1", "c1", "", []);
    h.unmount();
  });
});

describe("sending, scheduling and editing", () => {
  test("clear deletes the saved draft and drops the pending save", async () => {
    const h = open();
    await flushPromises();

    await type(h, "draft");
    await vi.advanceTimersByTimeAsync(2000);
    await type(h, "draft, more");

    void h.draft.clear();
    await type(h, "");
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();

    expect(h.api.save.mock.calls.map((c) => c[2])).toEqual(["draft", ""]);
    h.unmount();
  });

  test("clear costs no call when the server never had a draft", async () => {
    const h = open();
    await flushPromises();

    await type(h, "sent at once");
    void h.draft.clear();
    await type(h, "");
    await vi.advanceTimersByTimeAsync(5000);

    expect(h.api.save).not.toHaveBeenCalled();
    h.unmount();
  });

  test("nothing is saved while a message is edited, and the draft is saved before the edit takes over", async () => {
    const h = open();
    await flushPromises();

    await type(h, "mine");
    // What EnterText's watcher does once `editing` is set: flush, then the message replaces the text.
    h.editing.value = true;
    void h.draft.flush();
    await type(h, "the message being edited");
    await vi.advanceTimersByTimeAsync(5000);

    expect(h.api.save.mock.calls.map((c) => c[2])).toEqual(["mine"]);

    // The edit ends and the draft comes back: already on the server, so nothing to save.
    h.editing.value = false;
    await type(h, "mine");
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.api.save).toHaveBeenCalledTimes(1);
    h.unmount();
  });
});

describe("switching channels", () => {
  test("leaving sends the pending save at once, and the next composer reads after it", async () => {
    let finishSave!: () => void;
    const first = open({ api: { save: () => new Promise<void>((r) => (finishSave = r)) } });
    await flushPromises();

    await type(first, "half typed");
    first.unmount();
    await flushPromises();
    expect(first.api.save).toHaveBeenCalledWith("s1", "c1", "half typed", []);

    const second = open({ server: draftOf("half typed") });
    await flushPromises();
    expect(second.api.get).not.toHaveBeenCalled();

    finishSave();
    await flushPromises();
    expect(second.api.get).toHaveBeenCalledTimes(1);
    expect(second.text.value).toBe("half typed");
    second.unmount();
  });
});
