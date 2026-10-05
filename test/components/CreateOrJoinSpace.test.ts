/**
 * The create-a-space half of the join-or-create dialog. A refusal from the server is shown as the
 * reason it gave, in the user's language; an empty or over-long name never leaves the dialog; and
 * the name box stops at the server's limit so "too long" is a refusal only an API client can reach.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

const h = vi.hoisted(() => ({
  createSpace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ userInteraction: { CreateSpace: h.createSpace } }),
}));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({ refershDatas: h.refresh }) }));
vi.mock("@/store/ui/windowStore", () => ({ useWindow: () => ({ openInvitePreview: vi.fn() }) }));

import { CreateSpaceError, FailedCreateSpace, SuccessCreateSpace } from "@argon/glue";
import CreateOrJoinSpace from "@/components/modals/CreateOrJoinSpace.vue";

let mounted: VueWrapper[] = [];

afterEach(() => {
  for (const w of mounted) w.unmount();
  mounted = [];
  document.body.innerHTML = "";
});

beforeEach(() => {
  h.createSpace.mockReset();
  h.refresh.mockReset();
});

const flush = async () => {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

async function render() {
  const w = mount(CreateOrJoinSpace, { attachTo: document.body, props: { open: true } });
  mounted.push(w);
  await flush();
  return w;
}

const nameBox = () => document.body.querySelector<HTMLInputElement>("input:not(#invite-code)")!;
const createButton = () =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("create_new_server"))!;
const errorBadge = () => document.body.querySelector(".text-red-500 span, .text-red-500")?.textContent?.trim() ?? null;

async function typeName(text: string) {
  const box = nameBox();
  box.value = text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
}

async function create() {
  createButton().click();
  await flush();
}

describe("CreateOrJoinSpace", () => {
  test("the name box stops at the server's limit", async () => {
    await render();
    expect(nameBox().maxLength).toBe(64);
  });

  test("an empty name is refused without asking the server", async () => {
    await render();
    await typeName("   ");
    await create();
    expect(h.createSpace).not.toHaveBeenCalled();
    expect(errorBadge()).toBe("space_error_name_empty");
  });

  test("a name over the limit is refused without asking the server, with the limit in the message", async () => {
    await render();
    await typeName("a".repeat(65));
    await create();
    expect(h.createSpace).not.toHaveBeenCalled();
    expect(errorBadge()).toBe('space_error_name_too_long:{"max":64}');
  });

  test.each([
    [CreateSpaceError.NAME_TOO_LONG, 'space_error_name_too_long:{"max":64}'],
    [CreateSpaceError.NAME_EMPTY, "space_error_name_empty"],
    [CreateSpaceError.LIMIT_REACHED, "space_error_limit_reached"],
    [CreateSpaceError.DESCRIPTION_TOO_LONG, "space_error_description_too_long"],
    [CreateSpaceError.UNKNOWN, "space_error_unknown"],
    [99 as CreateSpaceError, "space_error_unknown"],
  ])("the server's refusal %s is shown as its reason", async (error, text) => {
    h.createSpace.mockResolvedValue(new FailedCreateSpace(error));
    const w = await render();
    await typeName("My space");
    await create();
    expect(h.createSpace).toHaveBeenCalledWith({ name: "My space", description: "", avatarFieldId: "" });
    expect(errorBadge()).toBe(text);
    expect(w.emitted("update:open")).toBeUndefined();
  });

  test("a failed call, not just a refusal, is reported rather than swallowed", async () => {
    h.createSpace.mockRejectedValue(new Error("boom"));
    await render();
    await typeName("My space");
    await create();
    expect(errorBadge()).toBe("space_error_unknown");
  });

  test("a created space closes the dialog and refreshes the pool", async () => {
    h.createSpace.mockResolvedValue(new SuccessCreateSpace({} as any));
    const w = await render();
    await typeName("  My space  ");
    await create();
    expect(h.createSpace).toHaveBeenCalledWith({ name: "My space", description: "", avatarFieldId: "" });
    expect(h.refresh).toHaveBeenCalled();
    expect(w.emitted("update:open")?.at(-1)).toEqual([false]);
    expect(errorBadge()).toBeNull();
  });
});
