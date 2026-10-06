<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from "vue";
import { Button } from "@argon/ui/button";
import { AlertCircleIcon, FingerprintIcon, Loader2, LockIcon, MailIcon, SmartphoneIcon } from "lucide-vue-next";
import { VerificationFactor } from "@argon/glue";
import InputWithError from "@/components/shared/InputWithError.vue";
import CodeInput from "@/components/shared/CodeInput.vue";
import type { VerificationFlowController } from "@/composables/useVerificationFlow";
import { useLocale } from "@/store/system/localeStore";

/**
 * The current requirement of a step-up flow: a password field, a code (sent to the current address
 * or from an authenticator app) or a passkey prompt, plus the other factors that would do as well.
 * Knows nothing of the action behind the flow; emits `verified` with the flowId to pass on. The
 * `actions` slot sits before the primary button (a dialog's Cancel).
 */
const props = defineProps<{ flow: VerificationFlowController }>();
const emit = defineEmits<{ verified: [flowId: string] }>();
const { t } = useLocale();

const { factor, alternatives, requirements, stepIndex, starting, busy, sending, codeSentTo, resendIn, error } = props.flow;

const FACTOR_LABEL: Record<VerificationFactor, string> = {
  [VerificationFactor.PASSWORD]: "verify_factor_password",
  [VerificationFactor.EMAIL_CODE]: "verify_factor_email_code",
  [VerificationFactor.TOTP]: "verify_factor_totp",
  [VerificationFactor.PASSKEY]: "verify_factor_passkey",
};

const FACTOR_ICON: Record<VerificationFactor, Component> = {
  [VerificationFactor.PASSWORD]: LockIcon,
  [VerificationFactor.EMAIL_CODE]: MailIcon,
  [VerificationFactor.TOTP]: SmartphoneIcon,
  [VerificationFactor.PASSKEY]: FingerprintIcon,
};

const root = ref<HTMLElement | null>(null);
const password = ref("");
const code = ref("");

const isCode = computed(() => factor.value === VerificationFactor.EMAIL_CODE || factor.value === VerificationFactor.TOTP);
const failedToStart = computed(() => !starting.value && props.flow.flow.value === null);

const canSubmit = computed(() => {
  if (busy.value) return false;
  if (factor.value === VerificationFactor.PASSWORD) return password.value.length > 0;
  if (isCode.value) return code.value.length === 6;
  return factor.value === VerificationFactor.PASSKEY;
});

const codePrompt = computed(() => {
  if (factor.value === VerificationFactor.TOTP) return t("verify_totp_prompt");
  if (codeSentTo.value) return t("verify_code_sent_to", { destination: codeSentTo.value });
  return sending.value ? t("verify_code_sending") : t("verify_code_not_sent");
});

const resendLabel = computed(() => {
  if (resendIn.value > 0) return t("verify_resend_in", { seconds: resendIn.value });
  return codeSentTo.value ? t("verify_resend_code") : t("send_code");
});

const primaryLabel = computed(() => {
  if (factor.value === VerificationFactor.PASSKEY) return busy.value ? t("passkey_waiting") : t("verify_passkey_button");
  if (busy.value) return t("verifying");
  return factor.value === VerificationFactor.PASSWORD ? t("continue") : t("verify");
});

watch(
  () => props.flow.verified.value,
  (verified) => {
    const id = props.flow.flowId.value;
    if (verified && id) emit("verified", id);
  },
  { immediate: true },
);

// A new flow or another factor starts from empty, focused fields.
watch([() => props.flow.flowId.value, factor], () => {
  password.value = "";
  code.value = "";
  void nextTick(() => root.value?.querySelector<HTMLInputElement>("input:not([disabled]):not([aria-hidden])")?.focus());
});

async function submitCurrent() {
  if (!canSubmit.value) return;
  if (factor.value === VerificationFactor.PASSKEY) {
    await props.flow.verifyWithPasskey();
    return;
  }
  const accepted = await props.flow.submit(factor.value === VerificationFactor.PASSWORD ? password.value : code.value);
  if (!accepted) {
    password.value = "";
    code.value = "";
  }
}

function onCodeComplete(value: string) {
  code.value = value;
  void submitCurrent();
}
</script>

<template>
  <div ref="root" class="space-y-4" data-testid="verification-step">
    <div v-if="starting" class="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground" data-testid="verification-starting">
      <Loader2 class="w-4 h-4 animate-spin" />
      {{ t("verify_identity_starting") }}
    </div>

    <template v-else-if="factor !== null">
      <div v-if="requirements.length > 1" class="flex items-center gap-3" data-testid="verification-progress">
        <div class="flex flex-1 gap-1.5">
          <span
            v-for="(_, i) in requirements"
            :key="i"
            class="h-1 flex-1 rounded-full transition-colors"
            :class="i <= stepIndex ? 'bg-primary' : 'bg-muted'"
          />
        </div>
        <span class="text-xs text-muted-foreground tabular-nums">
          {{ t("verify_identity_step", { current: stepIndex + 1, total: requirements.length }) }}
        </span>
      </div>

      <div v-if="factor === VerificationFactor.PASSWORD" @keydown.enter.prevent="submitCurrent">
        <InputWithError
          v-model="password"
          type="password"
          :placeholder="t('current_password')"
          :disabled="busy"
          data-testid="verification-password"
        >
          <template #label>
            <label class="text-sm font-medium">{{ t("current_password") }}</label>
          </template>
        </InputWithError>
      </div>

      <div v-else-if="isCode" class="space-y-3">
        <p class="text-sm text-muted-foreground" data-testid="verification-prompt">{{ codePrompt }}</p>
        <CodeInput v-model="code" :disabled="busy" @complete="onCodeComplete" />
        <div v-if="factor === VerificationFactor.EMAIL_CODE" class="flex justify-center">
          <Button
            variant="link"
            size="sm"
            class="h-auto p-0 text-xs"
            :disabled="sending || resendIn > 0"
            data-testid="verification-resend"
            @click="flow.resend()"
          >
            {{ resendLabel }}
          </Button>
        </div>
      </div>

      <div v-else-if="factor === VerificationFactor.PASSKEY" class="flex items-center gap-3 rounded-lg border p-3">
        <FingerprintIcon class="w-5 h-5 shrink-0 text-primary" />
        <p class="text-sm text-muted-foreground" data-testid="verification-prompt">{{ t("verify_passkey_prompt") }}</p>
      </div>
    </template>

    <p v-if="error" role="alert" class="flex items-start gap-1.5 text-sm text-destructive" data-testid="verification-error">
      <AlertCircleIcon class="w-4 h-4 mt-0.5 shrink-0" />
      <span>
        {{ t(error.key) }}
        <template v-if="error.attemptsLeft !== null">{{ t("verify_attempts_left", { count: error.attemptsLeft }) }}</template>
      </span>
    </p>

    <div v-if="!starting && alternatives.length" class="space-y-2 border-t pt-3" data-testid="verification-methods">
      <div class="text-xs text-muted-foreground">{{ t("verify_other_method") }}</div>
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="f in alternatives"
          :key="f"
          variant="outline"
          size="sm"
          :disabled="busy"
          :data-factor="VerificationFactor[f]"
          @click="flow.selectFactor(f)"
        >
          <component :is="FACTOR_ICON[f]" class="w-4 h-4 mr-1.5" />
          {{ t(FACTOR_LABEL[f]) }}
        </Button>
      </div>
    </div>

    <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <slot name="actions" />
      <Button v-if="failedToStart" data-testid="verification-retry" @click="flow.restart()">
        {{ t("try_again") }}
      </Button>
      <Button v-else-if="factor !== null" :disabled="!canSubmit" data-testid="verification-submit" @click="submitCurrent">
        <Loader2 v-if="busy" class="w-4 h-4 mr-2 animate-spin" />
        {{ primaryLabel }}
      </Button>
    </div>
  </div>
</template>
