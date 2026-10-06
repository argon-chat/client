<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { AlertCircleIcon, CheckCircle2Icon, Loader2 } from "lucide-vue-next";
import { EmailChangeError, SensitiveAction } from "@argon/glue";
import { logger } from "@argon/core";
import InputWithError from "@/components/shared/InputWithError.vue";
import CodeInput from "@/components/shared/CodeInput.vue";
import VerificationStep from "@/components/security/VerificationStep.vue";
import { useVerificationFlow } from "@/composables/useVerificationFlow";
import { useCountdown } from "@/composables/useCountdown";
import { confirmEmailChangeRefusal, emailChangeErrorKey } from "@/lib/refusals";
import { useApi } from "@/store/system/apiStore";
import { useLocale } from "@/store/system/localeStore";

/**
 * Changing the account email: confirm it's you (step-up flow), give the new address, enter the code
 * sent to it. Closing before the end cancels the flow on the server.
 */
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ changed: [email: string] }>();

const { t } = useLocale();
const api = useApi();
const verification = useVerificationFlow(SensitiveAction.CHANGE_EMAIL);

type Step = "verify" | "address" | "confirm" | "done";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const step = ref<Step>("verify");
const flowId = ref<string | null>(null);
const newEmail = ref("");
/** The address the last code went to. */
const sentTo = ref("");
const code = ref("");
const errorKey = ref<string | null>(null);
const busy = ref(false);
const resendAt = ref<Date | null>(null);
const resendIn = useCountdown(resendAt);
const body = ref<HTMLElement | null>(null);

const description = computed(() => {
  if (step.value === "verify") return t("verify_identity_desc");
  if (step.value === "address") return t("change_email_address_desc");
  if (step.value === "confirm") return t("change_email_code_desc", { email: sentTo.value });
  return t("change_email_done_desc", { email: sentTo.value });
});

watch(
  open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) start();
    else if (!isOpen && wasOpen) leave();
  },
  { immediate: true },
);

function start() {
  step.value = "verify";
  flowId.value = null;
  newEmail.value = "";
  sentTo.value = "";
  code.value = "";
  errorKey.value = null;
  busy.value = false;
  resendAt.value = null;
  void verification.begin();
}

function leave() {
  if (step.value === "done") verification.reset();
  else verification.cancel();
  flowId.value = null;
  resendAt.value = null;
}

function goTo(next: Step) {
  step.value = next;
  void nextTick(() => body.value?.querySelector<HTMLInputElement>("input:not([disabled]):not([aria-hidden])")?.focus());
}

function onVerified(id: string) {
  flowId.value = id;
  errorKey.value = null;
  goTo("address");
}

/** The flow behind the change is gone: confirm it's you again, saying why. */
function reverify(reasonKey: string) {
  flowId.value = null;
  code.value = "";
  errorKey.value = null;
  resendAt.value = null;
  step.value = "verify";
  void verification.restart(reasonKey);
}

/** Sends a code to the new address; again from the confirm step, to the same address. */
async function requestCode() {
  const id = flowId.value;
  const email = step.value === "confirm" ? sentTo.value : newEmail.value.trim();
  if (!id || busy.value) return;
  if (!EMAIL_SHAPE.test(email)) {
    errorKey.value = "email_change_error_invalid_email";
    return;
  }

  busy.value = true;
  errorKey.value = null;
  try {
    const result = await api.securityInteraction.RequestEmailChange(id, email);
    if (flowId.value !== id) return;
    if (result.isFailedRequestEmailChange()) {
      if (result.error === EmailChangeError.VERIFICATION_REQUIRED) reverify(emailChangeErrorKey(result.error));
      else errorKey.value = emailChangeErrorKey(result.error);
      return;
    }
    if (result.isSuccessRequestEmailChange()) {
      sentTo.value = email;
      resendAt.value = result.resendAt.toDate();
      code.value = "";
      if (step.value !== "confirm") goTo("confirm");
      return;
    }
    errorKey.value = "email_change_failed";
  } catch (e) {
    logger.warn("[email change] request failed", e);
    errorKey.value = "email_change_failed";
  } finally {
    busy.value = false;
  }
}

async function confirmCode() {
  const id = flowId.value;
  if (!id || busy.value || code.value.length !== 6) return;

  busy.value = true;
  errorKey.value = null;
  try {
    const refusal = confirmEmailChangeRefusal(await api.securityInteraction.ConfirmEmailChange(id, code.value));
    if (flowId.value !== id) return;
    if (refusal === null) {
      step.value = "done";
      emit("changed", sentTo.value);
      return;
    }

    code.value = "";
    const key = emailChangeErrorKey(refusal);
    if (refusal === EmailChangeError.VERIFICATION_REQUIRED) {
      reverify(key);
      return;
    }
    if (refusal === EmailChangeError.EMAIL_ALREADY_USED) {
      // Taken while the code was on its way; the flow is still verified, so pick another address.
      resendAt.value = null;
      goTo("address");
    }
    if (refusal === EmailChangeError.VERIFICATION_CODE_EXPIRED) resendAt.value = null;
    errorKey.value = key;
  } catch (e) {
    logger.warn("[email change] confirm failed", e);
    code.value = "";
    errorKey.value = "email_change_failed";
  } finally {
    busy.value = false;
  }
}

function onCodeComplete(value: string) {
  code.value = value;
  void confirmCode();
}

function otherAddress() {
  errorKey.value = null;
  code.value = "";
  goTo("address");
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent described class="max-w-[480px]" data-testid="change-email-dialog" @interactOutside.prevent>
      <DialogHeader>
        <DialogTitle>{{ step === "done" ? t("email_changed") : t("change_email") }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>

      <div ref="body">
        <VerificationStep v-if="step === 'verify'" :flow="verification" @verified="onVerified">
          <template #actions>
            <Button variant="outline" @click="open = false">{{ t("cancel") }}</Button>
          </template>
        </VerificationStep>

        <div v-else-if="step === 'address'" class="space-y-4" @keydown.enter.prevent="requestCode">
          <InputWithError
            v-model="newEmail"
            type="email"
            :placeholder="t('new_email_placeholder')"
            :disabled="busy"
            data-testid="change-email-address"
          >
            <template #label>
              <label class="text-sm font-medium">{{ t("new_email") }}</label>
            </template>
          </InputWithError>
        </div>

        <div v-else-if="step === 'confirm'" class="space-y-3">
          <CodeInput v-model="code" :disabled="busy" @complete="onCodeComplete" />
          <div class="flex items-center justify-center gap-4 text-xs">
            <Button
              variant="link"
              size="sm"
              class="h-auto p-0 text-xs"
              :disabled="busy || resendIn > 0"
              data-testid="change-email-resend"
              @click="requestCode"
            >
              {{ resendIn > 0 ? t("verify_resend_in", { seconds: resendIn }) : t("verify_resend_code") }}
            </Button>
            <Button variant="link" size="sm" class="h-auto p-0 text-xs" :disabled="busy" data-testid="change-email-other" @click="otherAddress">
              {{ t("change_email_other_address") }}
            </Button>
          </div>
        </div>

        <div v-else class="flex justify-center py-2" data-testid="change-email-done">
          <div class="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
            <CheckCircle2Icon class="w-6 h-6 text-green-500" />
          </div>
        </div>

        <p v-if="errorKey && step !== 'verify'" role="alert" class="mt-3 flex items-start gap-1.5 text-sm text-destructive" data-testid="change-email-error">
          <AlertCircleIcon class="w-4 h-4 mt-0.5 shrink-0" />
          <span>{{ t(errorKey) }}</span>
        </p>
      </div>

      <DialogFooter v-if="step !== 'verify'">
        <template v-if="step === 'done'">
          <Button data-testid="change-email-finish" @click="open = false">{{ t("done") }}</Button>
        </template>
        <template v-else>
          <Button variant="outline" @click="open = false">{{ t("cancel") }}</Button>
          <Button
            v-if="step === 'address'"
            :disabled="busy || !newEmail.trim()"
            data-testid="change-email-send"
            @click="requestCode"
          >
            <Loader2 v-if="busy" class="w-4 h-4 mr-2 animate-spin" />
            {{ busy ? t("sending") : t("send_code") }}
          </Button>
          <Button v-else :disabled="busy || code.length !== 6" data-testid="change-email-confirm" @click="confirmCode">
            <Loader2 v-if="busy" class="w-4 h-4 mr-2 animate-spin" />
            {{ busy ? t("verifying") : t("verify") }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
