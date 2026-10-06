/**
 * Step-up verification before a sensitive action. The server's requirements are walked in order,
 * each met by any one of its factors; the code to the current address goes out only once the
 * password is in, so a stolen session cannot flood the mailbox. A wrong answer says how many tries
 * are left; a flow that is gone on the server (expired, replaced, out of attempts) starts over and
 * says why. The resend button follows the server's resendAt, and walking away cancels the flow.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { effectScope, type EffectScope } from "vue";
import { flushPromises } from "@vue/test-utils";
import { IonDateTime } from "@argon-chat/ion.webcore";

const h = vi.hoisted(() => ({
  begin: vi.fn(),
  challenge: vi.fn(),
  submit: vi.fn(),
  cancel: vi.fn(),
  assertion: vi.fn(),
}));

vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("@argon/passkey", () => ({ getPasskeyAssertion: h.assertion }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    securityInteraction: {
      BeginVerification: h.begin,
      ChallengeVerification: h.challenge,
      SubmitVerification: h.submit,
      CancelVerification: h.cancel,
    },
  }),
}));

import {
  EmailChangeError,
  FailedBeginVerification,
  FailedChallengeVerification,
  FailedSubmitVerification,
  SensitiveAction,
  SuccessBeginVerification,
  SuccessSubmitVerification,
  VerificationCodeSent,
  VerificationError,
  VerificationFactor,
  VerificationPasskeyOptions,
  type VerificationFlow,
} from "@argon/glue";
import { useVerificationFlow } from "@/composables/useVerificationFlow";
import { emailChangeErrorKey, verificationErrorKey } from "@/lib/refusals";

const { PASSWORD, EMAIL_CODE, TOTP, PASSKEY } = VerificationFactor;

const at = (ms: number) => IonDateTime.fromDate(new Date(Date.now() + ms));

function flowOf(
  steps: [VerificationFactor[], boolean?][],
  extra: Partial<VerificationFlow> = {},
): VerificationFlow {
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

/** CHANGE_EMAIL for an account with a password, TOTP and a passkey. */
const fresh = (flowId = "f1") => flowOf([[[PASSWORD]], [[EMAIL_CODE, TOTP, PASSKEY]]], { flowId });
const pastPassword = (flowId = "f1") => flowOf([[[PASSWORD], true], [[EMAIL_CODE, TOTP, PASSKEY]]], { flowId });
const done = (flowId = "f1") => flowOf([[[PASSWORD], true], [[EMAIL_CODE, TOTP, PASSKEY], true]], { flowId, verified: true });

let scope: EffectScope | null = null;

function create() {
  scope = effectScope();
  return scope.run(() => useVerificationFlow(SensitiveAction.CHANGE_EMAIL))!;
}

async function pastThePassword() {
  const f = create();
  await f.begin();
  h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(pastPassword()));
  await f.submit("hunter2");
  await flushPromises();
  return f;
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.begin.mockResolvedValue(new SuccessBeginVerification(fresh()));
  h.challenge.mockResolvedValue(new VerificationCodeSent("y***@gmail.com", at(30_000)));
  h.cancel.mockResolvedValue(undefined);
});

afterEach(() => {
  scope?.stop();
  scope = null;
  vi.useRealTimers();
});

describe("walking the requirements", () => {
  test("password first; the code goes to the current address only once the password is accepted", async () => {
    const f = create();
    await f.begin();

    expect(h.begin).toHaveBeenCalledWith(SensitiveAction.CHANGE_EMAIL);
    expect(f.factor.value).toBe(PASSWORD);
    expect(f.stepIndex.value).toBe(0);
    expect(f.alternatives.value).toEqual([]);
    expect(h.challenge).not.toHaveBeenCalled();

    h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(pastPassword()));
    expect(await f.submit("hunter2")).toBe(true);
    await flushPromises();

    expect(h.submit).toHaveBeenCalledWith("f1", PASSWORD, "hunter2");
    expect(h.challenge).toHaveBeenCalledTimes(1);
    expect(h.challenge).toHaveBeenCalledWith("f1", EMAIL_CODE);
    expect(f.stepIndex.value).toBe(1);
    expect(f.factor.value).toBe(EMAIL_CODE);
    expect(f.alternatives.value).toEqual([TOTP, PASSKEY]);
    expect(f.codeSentTo.value).toBe("y***@gmail.com");

    h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(done()));
    expect(await f.submit("123456")).toBe(true);

    expect(h.submit).toHaveBeenLastCalledWith("f1", EMAIL_CODE, "123456");
    expect(f.verified.value).toBe(true);
    expect(f.flowId.value).toBe("f1");
    expect(f.factor.value).toBeNull();
  });

  test("an account without a password gets the code straight away", async () => {
    h.begin.mockResolvedValue(new SuccessBeginVerification(flowOf([[[EMAIL_CODE]]])));
    const f = create();
    await f.begin();
    await flushPromises();

    expect(f.factor.value).toBe(EMAIL_CODE);
    expect(h.challenge).toHaveBeenCalledWith("f1", EMAIL_CODE);
  });

  test("a refused begin says why and leaves nothing to submit", async () => {
    h.begin.mockResolvedValue(new FailedBeginVerification(VerificationError.RATE_LIMITED));
    const f = create();
    await f.begin();

    expect(f.flow.value).toBeNull();
    expect(f.error.value).toEqual({ key: "verify_error_rate_limited", attemptsLeft: null });
    expect(await f.submit("x")).toBe(false);
    expect(h.submit).not.toHaveBeenCalled();
  });
});

describe("wrong answers", () => {
  test("a wrong password or code says how many attempts are left", async () => {
    const f = create();
    await f.begin();

    h.submit.mockResolvedValueOnce(new FailedSubmitVerification(VerificationError.INVALID_PROOF, 4));
    expect(await f.submit("nope")).toBe(false);
    expect(f.error.value).toEqual({ key: "verify_error_invalid_password", attemptsLeft: 4 });
    expect(f.attemptsLeft.value).toBe(4);
    expect(f.factor.value).toBe(PASSWORD);

    h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(pastPassword()));
    await f.submit("hunter2");
    await flushPromises();
    expect(f.error.value).toBeNull();

    h.submit.mockResolvedValueOnce(new FailedSubmitVerification(VerificationError.INVALID_PROOF, 2));
    await f.submit("000000");
    expect(f.error.value).toEqual({ key: "verify_error_invalid_code", attemptsLeft: 2 });
  });

  test.each([
    [VerificationError.TOO_MANY_ATTEMPTS, "verify_error_too_many_attempts"],
    [VerificationError.FLOW_EXPIRED, "verify_error_flow_expired"],
  ])("%s starts a new flow and says why", async (error, key) => {
    const f = create();
    await f.begin();
    h.begin.mockResolvedValue(new SuccessBeginVerification(fresh("f2")));

    h.submit.mockResolvedValueOnce(new FailedSubmitVerification(error, 0));
    expect(await f.submit("nope")).toBe(false);
    await flushPromises();

    expect(h.begin).toHaveBeenCalledTimes(2);
    expect(f.flowId.value).toBe("f2");
    expect(f.factor.value).toBe(PASSWORD);
    expect(f.busy.value).toBe(false);
    expect(f.error.value).toEqual({ key, attemptsLeft: null });
  });

  test("an expired flow found while sending the code starts over too", async () => {
    h.challenge.mockResolvedValueOnce(new FailedChallengeVerification(VerificationError.FLOW_EXPIRED, null));
    const f = await pastThePassword();

    expect(h.begin).toHaveBeenCalledTimes(2);
    expect(f.error.value?.key).toBe("verify_error_flow_expired");
  });

  test("restart() begins again with the caller's reason", async () => {
    const f = create();
    await f.begin();
    h.begin.mockResolvedValue(new SuccessBeginVerification(fresh("f2")));

    await f.restart("email_change_error_verification_required");

    expect(f.flowId.value).toBe("f2");
    expect(f.error.value?.key).toBe("email_change_error_verification_required");
  });
});

describe("other methods", () => {
  test("switching from the email code to the authenticator app, and back without a second email", async () => {
    const f = await pastThePassword();

    f.selectFactor(TOTP);
    expect(f.factor.value).toBe(TOTP);
    expect(f.alternatives.value).toEqual([EMAIL_CODE, PASSKEY]);

    h.submit.mockResolvedValueOnce(new FailedSubmitVerification(VerificationError.INVALID_PROOF, 3));
    await f.submit("654321");
    expect(h.submit).toHaveBeenLastCalledWith("f1", TOTP, "654321");

    f.selectFactor(EMAIL_CODE);
    await flushPromises();
    expect(f.error.value).toBeNull();
    expect(h.challenge).toHaveBeenCalledTimes(1);
  });

  test("a factor the requirement does not offer is ignored", async () => {
    const f = create();
    await f.begin();
    f.selectFactor(TOTP);
    expect(f.factor.value).toBe(PASSWORD);
  });

  test("a passkey: challenge, the authenticator's assertion, then submit", async () => {
    const f = await pastThePassword();
    f.selectFactor(PASSKEY);

    h.challenge.mockResolvedValueOnce(new VerificationPasskeyOptions('{"challenge":"abc"}'));
    h.assertion.mockResolvedValueOnce({ success: true, response: '{"id":"cred"}' });
    h.submit.mockResolvedValueOnce(new SuccessSubmitVerification(done()));

    expect(await f.verifyWithPasskey()).toBe(true);
    expect(h.challenge).toHaveBeenLastCalledWith("f1", PASSKEY);
    expect(h.assertion).toHaveBeenCalledWith('{"challenge":"abc"}');
    expect(h.submit).toHaveBeenLastCalledWith("f1", PASSKEY, '{"id":"cred"}');
    expect(f.verified.value).toBe(true);
  });

  test("a cancelled passkey prompt is said as such and submits nothing", async () => {
    const f = await pastThePassword();
    f.selectFactor(PASSKEY);
    h.challenge.mockResolvedValueOnce(new VerificationPasskeyOptions("{}"));
    h.assertion.mockResolvedValueOnce({ success: false, error: "x", errorCode: "CANCELLED" });
    h.submit.mockClear();

    expect(await f.verifyWithPasskey()).toBe(false);
    expect(h.submit).not.toHaveBeenCalled();
    expect(f.error.value?.key).toBe("verify_error_passkey_cancelled");
    expect(f.busy.value).toBe(false);
  });
});

describe("resending the code", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  });

  test("the countdown follows resendAt; too early, the server's new resendAt is shown", async () => {
    const f = await pastThePassword();
    expect(f.resendIn.value).toBe(30);

    vi.advanceTimersByTime(10_000);
    expect(f.resendIn.value).toBe(20);
    await f.resend();
    expect(h.challenge).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(20_000);
    expect(f.resendIn.value).toBe(0);

    h.challenge.mockResolvedValueOnce(new FailedChallengeVerification(VerificationError.RATE_LIMITED, at(15_000)));
    await f.resend();
    expect(h.challenge).toHaveBeenCalledTimes(2);
    expect(f.error.value?.key).toBe("verify_error_resend_too_soon");
    expect(f.resendIn.value).toBe(15);
  });

  test("the hourly cap comes without a resendAt and reads differently", async () => {
    const f = await pastThePassword();
    vi.advanceTimersByTime(30_000);

    h.challenge.mockResolvedValueOnce(new FailedChallengeVerification(VerificationError.RATE_LIMITED, null));
    await f.resend();
    expect(f.error.value?.key).toBe("verify_error_rate_limited");
  });

  test("a code that expired or was never sent can be asked for again at once", async () => {
    const f = await pastThePassword();
    expect(f.resendIn.value).toBe(30);

    h.submit.mockResolvedValueOnce(new FailedSubmitVerification(VerificationError.CHALLENGE_REQUIRED, 5));
    await f.submit("123456");

    expect(f.error.value).toEqual({ key: "verify_error_challenge_required", attemptsLeft: null });
    expect(f.resendIn.value).toBe(0);
  });
});

describe("walking away", () => {
  test("cancel tells the server, drops the flow, and a late answer is ignored", async () => {
    const f = create();
    await f.begin();

    let answer!: (value: unknown) => void;
    h.submit.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const pending = f.submit("hunter2");

    f.cancel();
    expect(h.cancel).toHaveBeenCalledWith("f1");
    expect(f.flow.value).toBeNull();

    answer(new SuccessSubmitVerification(pastPassword()));
    expect(await pending).toBe(false);
    expect(f.flow.value).toBeNull();
    expect(h.challenge).not.toHaveBeenCalled();
  });

  test("a failing cancel is swallowed", async () => {
    h.cancel.mockRejectedValue(new Error("offline"));
    const f = create();
    await f.begin();
    f.cancel();
    await flushPromises();
    expect(h.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("error keys", () => {
  test("every verification error has its own message", () => {
    const keys = [
      VerificationError.FLOW_EXPIRED,
      VerificationError.FACTOR_NOT_ALLOWED,
      VerificationError.INVALID_PROOF,
      VerificationError.CHALLENGE_REQUIRED,
      VerificationError.TOO_MANY_ATTEMPTS,
      VerificationError.RATE_LIMITED,
      VerificationError.INTERNAL_ERROR,
    ].map((e) => verificationErrorKey(e));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("verification_failed");
    expect(verificationErrorKey(VerificationError.NONE)).toBe("verification_failed");
    expect(verificationErrorKey(VerificationError.INVALID_PROOF, PASSWORD)).toBe("verify_error_invalid_password");
    expect(verificationErrorKey(VerificationError.INVALID_PROOF, TOTP)).toBe("verify_error_invalid_code");
    expect(verificationErrorKey(VerificationError.INVALID_PROOF, PASSKEY)).toBe("verify_error_invalid_passkey");
  });

  test("every email change error has its own message", () => {
    const errors = [
      EmailChangeError.INVALID_EMAIL,
      EmailChangeError.EMAIL_ALREADY_USED,
      EmailChangeError.INVALID_PASSWORD,
      EmailChangeError.INVALID_VERIFICATION_CODE,
      EmailChangeError.VERIFICATION_CODE_EXPIRED,
      EmailChangeError.RATE_LIMITED,
      EmailChangeError.INTERNAL_ERROR,
      EmailChangeError.VERIFICATION_REQUIRED,
    ];
    const keys = errors.map(emailChangeErrorKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("email_change_failed");
    expect(emailChangeErrorKey(EmailChangeError.NONE)).toBe("email_change_failed");
  });
});
