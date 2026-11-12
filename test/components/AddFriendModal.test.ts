/**
 * Enter in the username box sends the request, the same as the button, and the dialog's other
 * buttons do not submit. A request in flight is not sent again by a second Enter.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { pressEnter } from "./support/pressEnter";

const h = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ freindsInteraction: { SendFriendRequest: h.send } }),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));

import { SendFriendStatus } from "@argon/glue";
import AddFriendModal from "@/components/modals/AddFriendModal.vue";

let mounted: VueWrapper[] = [];

afterEach(() => {
  for (const w of mounted) w.unmount();
  mounted = [];
  document.body.innerHTML = "";
});

beforeEach(() => {
  h.send.mockReset();
  h.send.mockResolvedValue(SendFriendStatus.SuccessSent);
});

const flush = async () => {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

async function render() {
  const w = mount(AddFriendModal, { attachTo: document.body, props: { open: true } });
  mounted.push(w);
  await flush();
  return w;
}

const usernameBox = () => document.body.querySelector<HTMLInputElement>("input")!;
const button = (key: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(key))!;

async function typeUsername(text: string) {
  const box = usernameBox();
  box.value = text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
}

describe("AddFriendModal", () => {
  test("Enter in the username box sends the request once", async () => {
    const w = await render();
    await typeUsername("  alice  ");
    pressEnter(usernameBox());
    await flush();

    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith("alice");
    expect(w.emitted("added")).toHaveLength(1);
  });

  test("Enter while the request is in flight sends nothing more", async () => {
    let resolve!: (s: SendFriendStatus) => void;
    h.send.mockImplementation(() => new Promise<SendFriendStatus>((r) => (resolve = r)));
    await render();
    await typeUsername("alice");

    pressEnter(usernameBox());
    await flush();
    expect(button("send_request").disabled).toBe(true);
    pressEnter(usernameBox());
    pressEnter(usernameBox());
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);

    resolve(SendFriendStatus.SuccessSent);
    await flush();
    expect(button("send_request").disabled).toBe(false);
  });

  test("Enter on an empty box shows the error without a request", async () => {
    await render();
    pressEnter(usernameBox());
    await flush();

    expect(h.send).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("empty_username");
  });

  test("the button still sends; Close does not", async () => {
    const w = await render();
    await typeUsername("bob");
    button("send_request").click();
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith("bob");

    button("close").click();
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(w.emitted("update:open")?.at(-1)).toEqual([false]);
  });
});
