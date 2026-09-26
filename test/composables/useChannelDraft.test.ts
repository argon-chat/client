/**
 * The server-side draft of a channel composer.
 *
 * An empty composer takes the channel's draft when it opens; typing saves it a few seconds after
 * the last keystroke, or at once when the composer loses focus, the window is hidden or the channel
 * is left; a send or a schedule deletes it. Editing a sent message borrows the composer, so nothing
 * is saved while it does. What each channel's draft is, the session remembers: a channel opened
 * again does not ask the server. An account switch stops everything still pending.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { EntityType, MessageEntityBold, type IMessageEntity, type MessageDraft } from "@argon/glue";
import { IonDateTime } from "@argon-chat/ion.webcore";

vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({}) }));

import {
  DRAFT_BLUR_GRACE_MS,
  DRAFT_SAVE_DELAY_MS,
  useChannelDraft,
  type DraftApi,
  type DraftTarget,
} from "@/composables/useChannelDraft";
import { parseMessageContent, serializeMessageContent } from "@/lib/chat/parseMessageContent";
import { runSessionReset } from "@/store/system/sessionLifecycle";

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

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(async () => {
  // The drafts this "session" learnt belong to the test that learnt them.
  await runSessionReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

describe("opening a channel", () => {
  test("an empty composer takes the draft, with its formatting, and does not save it back", async () => {
    const h = open({ server: draftOf("hello world", [new MessageEntityBold(EntityType.Bold, 6, 5, 1)]) });
    await flushPromises();

    expect(h.api.get).toHaveBeenCalledWith("s1", "c1");
    expect(h.text.value).toBe("hello **world**");

    await vi.advanceTimersByTimeAsync(10_000);
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

  test("a draft that loads after the user already sent from the composer does not come back", async () => {
    let answer!: (d: MessageDraft) => void;
    const h = open({ api: { get: () => new Promise<MessageDraft>((r) => (answer = r)) } });

    // Typed and sent before the answer: the composer is empty again, but not untouched.
    await type(h, "sent at once");
    void h.draft.clear();
    await type(h, "");
    answer(draftOf("an old draft"));
    await flushPromises();

    expect(h.text.value).toBe("");
    h.unmount();
  });

  test("a direct chat or a caption has no draft at all", async () => {
    const h = open({ target: null, server: draftOf("stored") });
    await flushPromises();
    await type(h, "hi there");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(h.api.get).not.toHaveBeenCalled();
    expect(h.api.save).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe("autosave", () => {
  test(`saves once, ${DRAFT_SAVE_DELAY_MS / 1000} seconds after the last keystroke, as parsed`, async () => {
    expect(DRAFT_SAVE_DELAY_MS).toBe(5000);
    const h = open();
    await flushPromises();

    await type(h, "**he**");
    await vi.advanceTimersByTimeAsync(4000);
    await type(h, "**hey**");
    await vi.advanceTimersByTimeAsync(4900);
    expect(h.api.save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(h.api.save).toHaveBeenCalledTimes(1);
    const [spaceId, channelId, text, entities] = h.api.save.mock.calls[0];
    expect([spaceId, channelId, text]).toEqual(["s1", "c1", "hey"]);
    expect(entities).toEqual([new MessageEntityBold(EntityType.Bold, 0, 3, 1)]);
    h.unmount();
  });

  test("the window being hidden saves at once", async () => {
    const h = open();
    await flushPromises();

    await type(h, "half a thought");
    setVisibility("hidden");
    await flushPromises();
    expect(h.api.save).toHaveBeenCalledWith("s1", "c1", "half a thought", []);

    // Nothing pending: nothing sent.
    await h.draft.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.api.save).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  test("the composer losing focus saves within a moment", async () => {
    const h = open();
    await flushPromises();

    await type(h, "half a thought");
    h.draft.blurred();
    await vi.advanceTimersByTimeAsync(DRAFT_BLUR_GRACE_MS);

    expect(h.api.save).toHaveBeenCalledWith("s1", "c1", "half a thought", []);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.api.save).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  test("a click on Send (which blurs the composer first) costs no save", async () => {
    const h = open();
    await flushPromises();

    await type(h, "sent with the button");
    h.draft.blurred();
    await vi.advanceTimersByTimeAsync(100);
    void h.draft.clear();
    await type(h, "");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(h.api.save).not.toHaveBeenCalled();
    h.unmount();
  });

  test("text over the limit is not saved", async () => {
    const h = open();
    await flushPromises();

    await type(h, "a".repeat(5000));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(h.api.save).not.toHaveBeenCalled();
    h.unmount();
  });

  test("a text shorter than three characters is not worth a call", async () => {
    const h = open();
    await flushPromises();

    await type(h, "ok");
    await vi.advanceTimersByTimeAsync(10_000);
    await h.draft.flush();

    expect(h.api.save).not.toHaveBeenCalled();
    h.unmount();
  });

  test("but it clears a draft the server has, and so does emptying the composer", async () => {
    const shortened = open({ server: draftOf("stored") });
    await flushPromises();
    await type(shortened, "st");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(shortened.api.save).toHaveBeenCalledWith("s1", "c1", "", []);
    shortened.unmount();

    await runSessionReset();
    const emptied = open({ server: draftOf("stored") });
    await flushPromises();
    await type(emptied, "");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(emptied.api.save).toHaveBeenCalledWith("s1", "c1", "", []);
    emptied.unmount();
  });
});

describe("sending, scheduling and editing", () => {
  test("clear deletes the saved draft and drops the pending save", async () => {
    const h = open();
    await flushPromises();

    await type(h, "draft");
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS);
    await type(h, "draft, more");

    void h.draft.clear();
    await type(h, "");
    await vi.advanceTimersByTimeAsync(10_000);
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
    await vi.advanceTimersByTimeAsync(10_000);

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
    await vi.advanceTimersByTimeAsync(10_000);

    expect(h.api.save.mock.calls.map((c) => c[2])).toEqual(["mine"]);

    // The edit ends and the draft comes back: already on the server, so nothing to save.
    h.editing.value = false;
    await type(h, "mine");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.api.save).toHaveBeenCalledTimes(1);
    h.unmount();
  });
});

describe("switching channels", () => {
  test("leaving sends the pending save at once, and the channel opened again takes it without asking", async () => {
    let finishSave!: () => void;
    const first = open({ api: { save: () => new Promise<void>((r) => (finishSave = r)) } });
    await flushPromises();

    await type(first, "half typed");
    first.unmount();
    await flushPromises();
    expect(first.api.save).toHaveBeenCalledWith("s1", "c1", "half typed", []);

    const second = open({ server: draftOf("something older") });
    await flushPromises();
    expect(second.api.get).not.toHaveBeenCalled();
    expect(second.text.value).toBe("half typed");

    finishSave();
    await flushPromises();
    second.unmount();
  });

  test("a channel whose draft was read once is not asked about again this session", async () => {
    const first = open({ server: draftOf("stored") });
    await flushPromises();
    first.unmount();

    const again = open({ server: draftOf("stored") });
    await flushPromises();
    expect(again.api.get).not.toHaveBeenCalled();
    expect(again.text.value).toBe("stored");
    again.unmount();

    // Nothing there is remembered too.
    await runSessionReset();
    const none = open({ server: null });
    await flushPromises();
    none.unmount();
    const noneAgain = open({ server: draftOf("never asked for") });
    await flushPromises();
    expect(noneAgain.api.get).not.toHaveBeenCalled();
    expect(noneAgain.text.value).toBe("");
    noneAgain.unmount();
  });

  test("a sent draft is remembered as gone: the channel opens empty", async () => {
    const h = open({ server: draftOf("stored") });
    await flushPromises();
    void h.draft.clear();
    await type(h, "");
    h.unmount();

    const again = open({ server: draftOf("stored") });
    await flushPromises();
    expect(again.api.get).not.toHaveBeenCalled();
    expect(again.text.value).toBe("");
    again.unmount();
  });
});

describe("switching accounts", () => {
  test("a pending save is dropped, not sent under the next account, and nothing is remembered", async () => {
    const h = open({ server: draftOf("stored") });
    await flushPromises();
    await type(h, "typed by the first account");

    await runSessionReset();
    await vi.advanceTimersByTimeAsync(10_000);
    h.unmount();
    await flushPromises();

    expect(h.api.save).not.toHaveBeenCalled();

    const next = open({ server: draftOf("the next account's") });
    await flushPromises();
    expect(next.api.get).toHaveBeenCalledTimes(1);
    expect(next.text.value).toBe("the next account's");
    next.unmount();
  });

  test("a draft answering after the switch is not put into the composer", async () => {
    let answer!: (d: MessageDraft) => void;
    const h = open({ api: { get: () => new Promise<MessageDraft>((r) => (answer = r)) } });

    await runSessionReset();
    answer(draftOf("the first account's"));
    await flushPromises();

    expect(h.text.value).toBe("");
    h.unmount();
  });
});
