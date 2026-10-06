/**
 * Changing the account email: confirm it's you first (the password, then a code to the current
 * address, or the authenticator app instead of that code), then give the new address and enter the
 * code sent to it. Every call after the step-up carries its flowId. Refusals are said in place: a
 * wrong password says how many tries are left, an address taken meanwhile sends the user back to
 * pick another, and a flow the server no longer has starts the step-up over. Closing before the end
 * cancels the flow on the server.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { IonDateTime } from "@argon-chat/ion.webcore";

const h = vi.hoisted(() => ({
  begin: vi.fn(),
  challenge: vi.fn(),
  submit: vi.fn(),
  cancel: vi.fn(),
  request: vi.fn(),
  confirm: vi.fn(),
  assertion: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    securityInteraction: {
      BeginVerification: h.begin,
      ChallengeVerification: h.challenge,
      SubmitVerification: h.submit,
      CancelVerification: h.cancel,
      RequestEmailChange: h.request,
      ConfirmEmailChange: h.confirm,
    },
  }),
}));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@argon/passkey", () => ({ getPasskeyAssertion: h.assertion }));

import {
  EmailChangeError,
  FailedChallengeVerification,
  FailedConfirmEmailChange,
  FailedRequestEmailChange,
  FailedSubmitVerification,
  SensitiveAction,
  SuccessBeginVerification,
  SuccessConfirmEmailChange,
  SuccessRequestEmailChange,
  SuccessSubmitVerification,
  VerificationCodeSent,
  VerificationError,
  VerificationFactor,
  type VerificationFlow,
} from "@argon/glue";
import ChangeEmailDialog from "@/components/settings/ChangeEmailDialog.vue";

const { PASSWORD, EMAIL_CODE, TOTP } = VerificationFactor;

const at = (ms: number) => IonDateTime.fromDate(new Date(Date.now() + ms));

function flowOf(steps: [VerificationFactor[], boolean?][], extra: Partial<VerificationFlow> = {}): VerificationFlow {
  return {
    flowId: "f1",
    action: SensitiveAction.CHANGE_EMAIL,
    requirements: steps.map(([factors, satisfied = false]) => ({ factors, satisfied })),
    verified: false,
    expiresAt: at(600_000),
    attemptsLeft: 5,
    ...extra,
  };
}

const fresh = (flowId = "f1") => flowOf([[[PASSWORD]], [[EMAIL_CODE, TOTP]]], { flowId });
const pastPassword = () => flowOf([[[PASSWORD], true], [[EMAIL_CODE, TOTP]]]);
const done = () => flowOf([[[PASSWORD], true], [[EMAIL_CODE, TOTP], true]], { verified: true });

let mounted: VueWrapper[] = [];

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.begin.mockResolvedValue(new SuccessBeginVerification(fresh()));
  h.challenge.mockResolvedValue(new VerificationCodeSent("y***@gmail.com", at(30_000)));
  h.cancel.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const w of mounted) w.unmount();
  mounted = [];
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const flush = async () => {
  await flushPromises();
  await nextTick();
};

async function render() {
  let w!: VueWrapper;
  w = mount(ChangeEmailDialog, {
    attachTo: document.body,
    props: { open: true, "onUpdate:open": (open: boolean) => w.setProps({ open }) },
  });
  mounted.push(w);
  await flush();
  return w;
}

const $ = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const textOf = (selector: string) => $(selector)?.textContent ?? "";

async function click(el: HTMLElement | null) {
  expect(el).not.toBeNull();
  el!.click();
  await flush();
}

async function type(selector: string, value: string) {
  const input = $(selector) as HTMLInputElement;
  expect(input).not.toBeNull();
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await flush();
}

/** Pastes a whole code into the first box, which fills the rest and completes the input. */
async function enterCode(code: string) {
  const first = $('[data-testid="code-input"] input') as HTMLInputElement;
  expect(first).not.toBeNull();
  first.value = code;
  first.dispatchEvent(new InputEvent("input", { data: code }));
  await flush();
}

async function enterPassword(password = "hunter2") {
  await type('[data-testid="verification-password"] input', password);
  await click($('[data-testid="verification-submit"]'));
}

/** Through the step-up, onto the new address step. */
async function passStepUp() {
  h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(pastPassword()));
  await enterPassword();
  h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(done()));
  await enterCode("111111");
  expect($('[data-testid="change-email-address"]')).not.toBeNull();
}

async function sendToNewAddress(email = "new@example.com") {
  h.request.mockResolvedValueOnce(new SuccessRequestEmailChange(at(60_000)));
  await type('[data-testid="change-email-address"] input', email);
  await click($('[data-testid="change-email-send"]'));
}

describe("the whole change", () => {
  test("password, the code to the current address, the new address and its code; every call carries the flow", async () => {
    const w = await render();
    expect(h.begin).toHaveBeenCalledWith(SensitiveAction.CHANGE_EMAIL);
    expect(h.challenge).not.toHaveBeenCalled();

    h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(pastPassword()));
    await enterPassword();
    expect(h.submit).toHaveBeenCalledWith("f1", PASSWORD, "hunter2");
    expect(h.challenge).toHaveBeenCalledTimes(1);
    expect(h.challenge).toHaveBeenCalledWith("f1", EMAIL_CODE);
    expect(textOf('[data-testid="verification-prompt"]')).toContain('verify_code_sent_to:{"destination":"y***@gmail.com"}');

    h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(done()));
    await enterCode("111111");
    expect(h.submit).toHaveBeenLastCalledWith("f1", EMAIL_CODE, "111111");

    await sendToNewAddress("new@example.com");
    expect(h.request).toHaveBeenCalledWith("f1", "new@example.com");

    h.confirm.mockResolvedValueOnce(new SuccessConfirmEmailChange());
    await enterCode("222222");
    expect(h.confirm).toHaveBeenCalledWith("f1", "222222");
    expect($('[data-testid="change-email-done"]')).not.toBeNull();
    expect(w.emitted("changed")).toEqual([["new@example.com"]]);

    await click($('[data-testid="change-email-finish"]'));
    expect(w.emitted("update:open")?.at(-1)).toEqual([false]);
    expect(h.cancel).not.toHaveBeenCalled();
  });

  test("a malformed address never reaches the server", async () => {
    await render();
    await passStepUp();

    await type('[data-testid="change-email-address"] input', "not-an-address");
    await click($('[data-testid="change-email-send"]'));

    expect(h.request).not.toHaveBeenCalled();
    expect(textOf('[data-testid="change-email-error"]')).toContain("email_change_error_invalid_email");
  });
});

describe("confirming it's you", () => {
  test("a wrong password says how many attempts are left", async () => {
    await render();
    h.submit.mockResolvedValueOnce(new FailedSubmitVerification(VerificationError.INVALID_PROOF, 4));
    await enterPassword("nope");

    const error = textOf('[data-testid="verification-error"]');
    expect(error).toContain("verify_error_invalid_password");
    expect(error).toContain('verify_attempts_left:{"count":4}');
    expect(h.challenge).not.toHaveBeenCalled();
    expect(($('[data-testid="verification-password"] input') as HTMLInputElement).value).toBe("");
  });

  test("too many wrong attempts start the step-up over, from the password", async () => {
    await render();
    h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(pastPassword()));
    await enterPassword();

    h.begin.mockResolvedValue(new SuccessBeginVerification(fresh("f2")));
    h.submit.mockResolvedValueOnce(new FailedSubmitVerification(VerificationError.TOO_MANY_ATTEMPTS, 0));
    await enterCode("000000");

    expect(h.begin).toHaveBeenCalledTimes(2);
    expect($('[data-testid="verification-password"]')).not.toBeNull();
    expect(textOf('[data-testid="verification-error"]')).toContain("verify_error_too_many_attempts");

    h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(pastPassword()));
    await enterPassword();
    expect(h.submit).toHaveBeenLastCalledWith("f2", PASSWORD, "hunter2");
  });

  test("the authenticator app can stand in for the emailed code", async () => {
    await render();
    h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(pastPassword()));
    await enterPassword();

    await click($(`[data-factor="${VerificationFactor[TOTP]}"]`));
    expect(textOf('[data-testid="verification-prompt"]')).toContain("verify_totp_prompt");
    expect($('[data-testid="verification-resend"]')).toBeNull();

    h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(done()));
    await enterCode("654321");

    expect(h.submit).toHaveBeenLastCalledWith("f1", TOTP, "654321");
    expect(h.challenge).toHaveBeenCalledTimes(1);
    expect($('[data-testid="change-email-address"]')).not.toBeNull();
  });

  test("the resend button counts down to resendAt; too early, it follows the server's new time", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    await render();
    h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(pastPassword()));
    await enterPassword();

    const resend = () => $('[data-testid="verification-resend"]') as HTMLButtonElement;
    expect(resend().textContent).toContain('verify_resend_in:{"seconds":30}');
    expect(resend().disabled).toBe(true);

    vi.advanceTimersByTime(30_000);
    await nextTick();
    expect(resend().textContent).toContain("verify_resend_code");
    expect(resend().disabled).toBe(false);

    h.challenge.mockResolvedValueOnce(new FailedChallengeVerification(VerificationError.RATE_LIMITED, at(20_000)));
    await click(resend());

    expect(h.challenge).toHaveBeenCalledTimes(2);
    expect(textOf('[data-testid="verification-error"]')).toContain("verify_error_resend_too_soon");
    expect(resend().textContent).toContain('verify_resend_in:{"seconds":20}');
  });
});

describe("the new address", () => {
  test("taken while the code was on its way: back to the address, the flow kept", async () => {
    await render();
    await passStepUp();
    await sendToNewAddress("taken@example.com");

    h.confirm.mockResolvedValueOnce(new FailedConfirmEmailChange(EmailChangeError.EMAIL_ALREADY_USED));
    await enterCode("222222");

    expect($('[data-testid="change-email-address"]')).not.toBeNull();
    expect(textOf('[data-testid="change-email-error"]')).toContain("email_change_error_already_used");
    expect(h.begin).toHaveBeenCalledTimes(1);

    await sendToNewAddress("free@example.com");
    expect(h.request).toHaveBeenLastCalledWith("f1", "free@example.com");
  });

  test.each([
    ["requesting the code", "request"],
    ["confirming the code", "confirm"],
  ])("verification required while %s starts the step-up over", async (_, where) => {
    await render();
    await passStepUp();
    h.begin.mockResolvedValue(new SuccessBeginVerification(fresh("f2")));

    if (where === "request") {
      h.request.mockResolvedValueOnce(new FailedRequestEmailChange(EmailChangeError.VERIFICATION_REQUIRED));
      await type('[data-testid="change-email-address"] input', "new@example.com");
      await click($('[data-testid="change-email-send"]'));
    } else {
      await sendToNewAddress();
      h.confirm.mockResolvedValueOnce(new FailedConfirmEmailChange(EmailChangeError.VERIFICATION_REQUIRED));
      await enterCode("222222");
    }

    expect(h.begin).toHaveBeenCalledTimes(2);
    expect($('[data-testid="verification-password"]')).not.toBeNull();
    expect(textOf('[data-testid="verification-error"]')).toContain("email_change_error_verification_required");
  });

  test("a wrong or expired code is said in place; an expired one can be resent at once", async () => {
    await render();
    await passStepUp();
    await sendToNewAddress();
    expect(($('[data-testid="change-email-resend"]') as HTMLButtonElement).disabled).toBe(true);

    h.confirm.mockResolvedValueOnce(new FailedConfirmEmailChange(EmailChangeError.INVALID_VERIFICATION_CODE));
    await enterCode("999999");
    expect(textOf('[data-testid="change-email-error"]')).toContain("email_change_error_invalid_code");

    h.confirm.mockResolvedValueOnce(new FailedConfirmEmailChange(EmailChangeError.VERIFICATION_CODE_EXPIRED));
    await enterCode("888888");
    expect(textOf('[data-testid="change-email-error"]')).toContain("email_change_error_code_expired");

    const resend = $('[data-testid="change-email-resend"]') as HTMLButtonElement;
    expect(resend.disabled).toBe(false);
    h.request.mockResolvedValueOnce(new SuccessRequestEmailChange(at(60_000)));
    await click(resend);
    expect(h.request).toHaveBeenLastCalledWith("f1", "new@example.com");
  });
});

describe("walking away", () => {
  test("cancel during the step-up cancels the flow and closes", async () => {
    const w = await render();

    const cancel = [...document.body.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.trim() === "cancel");
    await click(cancel ?? null);

    expect(w.emitted("update:open")?.at(-1)).toEqual([false]);
    expect(h.cancel).toHaveBeenCalledWith("f1");
  });

  test("closing on the new address step cancels the verified flow too", async () => {
    const w = await render();
    await passStepUp();

    await w.setProps({ open: false });
    await flush();

    expect(h.cancel).toHaveBeenCalledWith("f1");
  });

  test("opening again begins a fresh flow", async () => {
    const w = await render();
    await w.setProps({ open: false });
    await flush();
    await w.setProps({ open: true });
    await flush();

    expect(h.begin).toHaveBeenCalledTimes(2);
    expect($('[data-testid="verification-password"]')).not.toBeNull();
  });
});
