import { computed, ref, shallowRef } from "vue";
import {
  Ion_VerificationFactor_OpenEnum,
  VerificationError,
  VerificationFactor,
  type SensitiveAction,
  type VerificationFlow,
} from "@argon/glue";
import { logger } from "@argon/core";
import { getPasskeyAssertion, type PasskeyAssertionResult } from "@argon/passkey";
import { useApi } from "@/store/system/apiStore";
import { useCountdown } from "@/composables/useCountdown";
import { verificationErrorKey } from "@/lib/refusals";

/**
 * Step-up verification: proof that whoever holds this session holds the account right now, asked
 * before one sensitive action.
 *
 * begin() opens a flow for the action. Its requirements are walked in order, each met by any one of
 * its factors (the first is offered, the others are alternatives). The code to the current address
 * is only sent once the requirements before it are met, so a stolen session without the password
 * cannot flood the mailbox. Once `verified`, the action's own call takes `flowId`; when that call
 * answers that verification is needed again, restart().
 *
 * Another action reuses this as is: create it with that SensitiveAction, render
 * <VerificationStep :flow> until it emits `verified`, then make the action's call with the flowId,
 * and cancel() if the user walks away first.
 */

/** What to tell the user: an i18n key, plus the attempts left after a wrong answer. */
export type VerificationNotice = { key: string; attemptsLeft: number | null };

type PasskeyFailure = Extract<PasskeyAssertionResult, { success: false }>["errorCode"];

const PASSKEY_ERRORS: Record<PasskeyFailure, string> = {
  CANCELLED: "verify_error_passkey_cancelled",
  NOT_SUPPORTED: "verify_error_passkey_unsupported",
  NOT_FOUND: "verify_error_passkey_not_found",
  UNKNOWN: "passkey_test_error",
};

const notice = (key: string, attemptsLeft: number | null = null): VerificationNotice => ({ key, attemptsLeft });

export function useVerificationFlow(action: SensitiveAction) {
  const api = useApi();

  const flow = shallowRef<VerificationFlow | null>(null);
  const factor = ref<VerificationFactor | null>(null);
  const starting = ref(false);
  /** A proof is being checked, or a passkey prompt is up. */
  const busy = ref(false);
  /** The code to the current address is on its way. */
  const sending = ref(false);
  /** The masked address the code went to; null until one was sent in this flow. */
  const codeSentTo = ref<string | null>(null);
  const resendAt = ref<Date | null>(null);
  const resendIn = useCountdown(resendAt);
  const attemptsLeft = ref<number | null>(null);
  const error = shallowRef<VerificationNotice | null>(null);

  // Bumped whenever the flow is dropped, so an answer that arrives for the old one is ignored.
  let generation = 0;

  const requirements = computed(() => flow.value?.requirements ?? []);
  const stepIndex = computed(() => requirements.value.findIndex((r) => !r.satisfied));
  const requirement = computed(() => (stepIndex.value >= 0 ? requirements.value[stepIndex.value] : null));
  /** The current requirement's factors this build knows, in the server's order. */
  const factors = computed(() => requirement.value?.factors.filter((f) => Ion_VerificationFactor_OpenEnum.isKnown(f)) ?? []);
  const alternatives = computed(() => factors.value.filter((f) => f !== factor.value));
  const verified = computed(() => flow.value?.verified === true);
  const flowId = computed(() => flow.value?.flowId ?? null);

  /** Drops the flow here without telling the server (it is finished, or about to be replaced). */
  function reset() {
    generation++;
    flow.value = null;
    factor.value = null;
    starting.value = false;
    busy.value = false;
    sending.value = false;
    codeSentTo.value = null;
    resendAt.value = null;
    attemptsLeft.value = null;
    error.value = null;
  }

  /** Opens a new flow, replacing any other; `reasonKey` says why when it is a restart. */
  async function begin(reasonKey: string | null = null) {
    reset();
    const gen = generation;
    starting.value = true;
    try {
      const result = await api.securityInteraction.BeginVerification(action);
      if (gen !== generation) return;
      if (result.isFailedBeginVerification()) {
        error.value = notice(verificationErrorKey(result.error));
      } else if (result.isSuccessBeginVerification()) {
        error.value = reasonKey ? notice(reasonKey) : null;
        adopt(result.flow);
      } else {
        error.value = notice("verification_failed");
      }
    } catch (e) {
      if (gen !== generation) return;
      logger.warn("[verification] begin failed", e);
      error.value = notice("verification_failed");
    } finally {
      if (gen === generation) starting.value = false;
    }
  }

  function adopt(next: VerificationFlow) {
    flow.value = next;
    attemptsLeft.value = next.attemptsLeft;
    if (next.verified || !requirement.value) {
      factor.value = null;
      return;
    }
    if (factor.value !== null && factors.value.includes(factor.value)) return;

    const first = factors.value[0];
    if (first === undefined) {
      factor.value = null;
      error.value = notice("verify_error_factor_not_allowed");
      return;
    }
    use(first);
  }

  function use(next: VerificationFactor) {
    factor.value = next;
    if (next === VerificationFactor.EMAIL_CODE && codeSentTo.value === null && !sending.value) void sendCode();
  }

  /** Switches the current requirement to another of its factors. */
  function selectFactor(next: VerificationFactor) {
    if (busy.value || !factors.value.includes(next)) return;
    error.value = null;
    use(next);
  }

  function refuse(code: VerificationError, attempts: number | null = null) {
    const key = verificationErrorKey(code, factor.value);
    // The flow is gone on the server: start over, saying why.
    if (code === VerificationError.FLOW_EXPIRED || code === VerificationError.TOO_MANY_ATTEMPTS) {
      void begin(key);
      return;
    }
    if (code === VerificationError.CHALLENGE_REQUIRED) resendAt.value = null;
    error.value = notice(key, code === VerificationError.INVALID_PROOF ? attempts : null);
  }

  async function sendCode() {
    const id = flow.value?.flowId;
    if (!id || sending.value) return;
    const gen = generation;
    sending.value = true;
    try {
      const result = await api.securityInteraction.ChallengeVerification(id, VerificationFactor.EMAIL_CODE);
      if (gen !== generation) return;
      if (result.isFailedChallengeVerification()) {
        const until = result.resendAt?.toDate() ?? null;
        if (until) resendAt.value = until;
        if (result.error === VerificationError.RATE_LIMITED && until) error.value = notice("verify_error_resend_too_soon");
        else refuse(result.error);
      } else if (result.isVerificationCodeSent()) {
        codeSentTo.value = result.destination;
        resendAt.value = result.resendAt.toDate();
      } else {
        error.value = notice("verification_failed");
      }
    } catch (e) {
      if (gen !== generation) return;
      logger.warn("[verification] sending the code failed", e);
      error.value = notice("verification_failed");
    } finally {
      if (gen === generation) sending.value = false;
    }
  }

  /** Sends the code to the current address again, or for the first time after a failed send. */
  async function resend() {
    if (resendIn.value > 0 || factor.value !== VerificationFactor.EMAIL_CODE) return;
    error.value = null;
    await sendCode();
  }

  async function check(id: string, f: VerificationFactor, proof: string): Promise<boolean> {
    const gen = generation;
    try {
      const result = await api.securityInteraction.SubmitVerification(id, f, proof);
      if (gen !== generation) return false;
      if (result.isFailedSubmitVerification()) {
        attemptsLeft.value = result.attemptsLeft;
        refuse(result.error, result.attemptsLeft);
        return false;
      }
      if (result.isSuccessSubmitVerification()) {
        error.value = null;
        adopt(result.flow);
        return true;
      }
      error.value = notice("verification_failed");
    } catch (e) {
      if (gen !== generation) return false;
      logger.warn("[verification] submit failed", e);
      error.value = notice("verification_failed");
    }
    return false;
  }

  /** Checks a password or a code for the current factor; true when it was accepted. */
  async function submit(proof: string): Promise<boolean> {
    const id = flow.value?.flowId;
    const f = factor.value;
    if (!id || f === null || f === VerificationFactor.PASSKEY || busy.value || !proof) return false;
    const gen = generation;
    busy.value = true;
    error.value = null;
    try {
      return await check(id, f, proof);
    } finally {
      if (gen === generation) busy.value = false;
    }
  }

  /** Asks the server for a challenge, has the authenticator sign it, and submits the assertion. */
  async function verifyWithPasskey(): Promise<boolean> {
    const id = flow.value?.flowId;
    if (!id || factor.value !== VerificationFactor.PASSKEY || busy.value) return false;
    const gen = generation;
    busy.value = true;
    error.value = null;
    try {
      const challenge = await api.securityInteraction.ChallengeVerification(id, VerificationFactor.PASSKEY);
      if (gen !== generation) return false;
      if (challenge.isFailedChallengeVerification()) {
        refuse(challenge.error);
        return false;
      }
      if (!challenge.isVerificationPasskeyOptions()) {
        error.value = notice("verification_failed");
        return false;
      }
      const assertion = await getPasskeyAssertion(challenge.optionsJson);
      if (gen !== generation) return false;
      if (!assertion.success) {
        error.value = notice(PASSKEY_ERRORS[assertion.errorCode]);
        return false;
      }
      return await check(id, VerificationFactor.PASSKEY, assertion.response);
    } catch (e) {
      if (gen === generation) {
        logger.warn("[verification] passkey failed", e);
        error.value = notice("verification_failed");
      }
      return false;
    } finally {
      if (gen === generation) busy.value = false;
    }
  }

  async function forget(id: string) {
    try {
      await api.securityInteraction.CancelVerification(id);
    } catch (e) {
      logger.warn("[verification] cancel failed", e);
    }
  }

  /** The user walked away: drop the flow here and on the server (fire-and-forget). */
  function cancel() {
    const id = flow.value?.flowId ?? null;
    reset();
    if (id) void forget(id);
  }

  return {
    flow,
    flowId,
    requirements,
    stepIndex,
    requirement,
    factors,
    factor,
    alternatives,
    verified,
    starting,
    busy,
    sending,
    codeSentTo,
    resendAt,
    resendIn,
    attemptsLeft,
    error,
    begin,
    restart: begin,
    selectFactor,
    resend,
    submit,
    verifyWithPasskey,
    cancel,
    reset,
  };
}

export type VerificationFlowController = ReturnType<typeof useVerificationFlow>;
