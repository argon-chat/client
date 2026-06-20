<script setup lang="ts">
import { Button } from "@argon/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@argon/ui/card";
import { Input } from "@argon/ui/input";
import { Label } from "@argon/ui/label";
import { onMounted, ref, watch, nextTick } from "vue";
import QRStyled from "./QRStyled.vue";
import SmoothResize from "../shared/SmoothResize.vue";
import BorderTrace from "../shared/BorderTrace.vue";
import { ExclamationTriangleIcon } from "@radix-icons/vue";
import { useLocale } from "@/store/system/localeStore";
import InputWithError from "../shared/InputWithError.vue";
import {
    MailIcon,
    LockIcon,
    LogInIcon,
    Loader2Icon,
    ArrowRightIcon,
    QrCodeIcon,
    EyeIcon,
    EyeOffIcon,
    ServerIcon,
} from "lucide-vue-next";

const { t } = useLocale();
const props = defineProps<{ auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm> }>();
const {
  email, password, isLoading, goToResetPass, onSubmit, authError,
  prepareEmailStep, effectiveOfficial, effectiveBranding, showQr, useOfficial, isEnroll,
} = props.auth;

// Local busy flag for the email step's async resolution (separate from auth's isLoading,
// which only covers the actual sign-in call).
const stepBusy = ref(false);

const titles = [
  { title: t("greetings.good_to_see_you.title"), desc: t("greetings.good_to_see_you.desc") },
  { title: t("greetings.hey_there.title"), desc: t("greetings.hey_there.desc") },
  { title: t("greetings.welcome_back.title"), desc: t("greetings.welcome_back.desc") },
  { title: t("greetings.glad_you_here.title"), desc: t("greetings.glad_you_here.desc") },
  { title: t("greetings.hello_again.title"), desc: t("greetings.hello_again.desc") },
];
const heading = ref(titles[0]);
function pickRandomHeading() {
  heading.value = titles[Math.floor(Math.random() * titles.length)];
}

const qrLoginUrl = ref("https://www.youtube.com/watch?v=HIcSWuKMwOw");
const step = ref<"email" | "password">("email");
const showPassword = ref(false);
const formEl = ref<HTMLFormElement | null>(null);
// Bumped on each new error to replay the BorderTrace error pulse.
const traceKey = ref(0);

// Focus whatever the single editable input is for the current step
// (email step → email; password step → password, since email collapses to text).
function focusActiveInput() {
  nextTick(() => formEl.value?.querySelector<HTMLInputElement>("input")?.focus());
}

onMounted(() => {
  pickRandomHeading();
  focusActiveInput();
});

async function handleNext() {
  if (!email.value || stepBusy.value) return;
  stepBusy.value = true;
  try {
    // Resolve the target instance (enterprise/SaaS or self-hosted) and check the auth scenario.
    // Branches primary vs enroll inside useAuthForm so the live session is never disturbed in the
    // "add account" modal.
    const scenario = await prepareEmailStep(email.value);
    if (!scenario) return;
    if (scenario === "pwd" || scenario === "pwd-otp") {
      step.value = "password";
    } else if (scenario === "otp") {
      onSubmit();
    }
  } finally {
    stepBusy.value = false;
  }
}

// Enter / submit routes by step: continue on email, sign in on password.
function handleFormSubmit() {
  if (step.value === "email") handleNext();
  else onSubmit();
}

watch(email, (newVal, oldVal) => {
  if (step.value === "password" && newVal !== oldVal) {
    step.value = "email";
  }
});

watch(step, () => focusActiveInput());

// Pulse the card border whenever a new auth error appears.
watch(authError, (v, prev) => {
  if (v && !prev) traceKey.value++;
});

// Clear the error once the user starts correcting the password.
watch(password, () => {
  if (authError.value) authError.value = "";
});
</script>

<template>
  <Card class="login-card relative flex flex-row overflow-hidden">
    <BorderTrace v-if="traceKey > 0" :key="traceKey" />

    <form ref="formEl" @submit.prevent="handleFormSubmit" novalidate class="w-[400px] flex flex-col justify-center">
      <CardHeader class="text-center pb-2">
        <div class="flex justify-center mb-3">
          <div class="icon-box">
            <LogInIcon class="w-6 h-6 text-primary" />
          </div>
        </div>
        <CardTitle class="text-2xl font-bold text-white">{{ heading.title }}</CardTitle>
        <CardDescription class="text-muted-foreground">{{ heading.desc }}</CardDescription>

        <div v-if="!effectiveOfficial" class="flex items-center justify-center gap-2 mt-3">
          <span class="instance-chip">
            <ServerIcon class="w-3.5 h-3.5 text-primary" />
            {{ t("connected_to") }} {{ effectiveBranding.displayName }}
          </span>
          <button type="button" @click="useOfficial" class="text-xs text-primary hover:underline">
            {{ t("use_official") }}
          </button>
        </div>
      </CardHeader>

      <CardContent class="pt-4">
        <SmoothResize>
          <div v-if="step === 'email'" key="email-step" class="space-y-4">
            <div class="input-group">
              <div class="flex items-center gap-2 mb-2">
                <MailIcon class="w-4 h-4 text-primary" />
                <Label for="email" class="text-sm font-medium">Email</Label>
              </div>
              <InputWithError
                v-model="email"
                :error="authError"
                @clear-error="authError = ''"
                type="email"
                placeholder="example@email.com"
                :disabled="isLoading"
                id="email"
                class="input-styled"
              />
            </div>
          </div>

          <div v-else key="password-step" class="space-y-4">
            <div class="input-group">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <MailIcon class="w-4 h-4 text-primary" />
                  <Label class="text-sm font-medium">Email</Label>
                </div>
                <button type="button" @click="step = 'email'; authError = ''" class="text-xs text-primary hover:underline">
                  {{ t("change") }}
                </button>
              </div>
              <div class="px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground truncate">
                {{ email }}
              </div>
            </div>

            <div class="input-group relative">
              <Transition name="slide-fade">
                <div v-if="authError" role="alert" class="absolute top-[-6px] right-[-8px] z-20 px-2 py-0.5
                     bg-popover/95 backdrop-blur-sm border border-red-500
                     text-red-500 dark:text-red-400 text-[12px] font-mono tracking-wider
                     rounded-md shadow-lg flex items-center gap-1
                     translate-x-2 -translate-y-1">
                  <ExclamationTriangleIcon class="w-4 h-4 shrink-0 text-red-500" />
                  <span>{{ authError }}</span>
                </div>
              </Transition>

              <div class="flex items-center gap-2 mb-2">
                <LockIcon class="w-4 h-4 text-primary" />
                <Label for="password" class="text-sm font-medium">{{ t("password") }}</Label>
              </div>
              <div class="relative">
                <Input
                  id="password"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  placeholder="••••••••"
                  class="input-styled pr-10"
                  :disabled="isLoading"
                />
                <button
                  type="button"
                  @click="showPassword = !showPassword"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors"
                >
                  <EyeOffIcon v-if="showPassword" class="w-4 h-4" />
                  <EyeIcon v-else class="w-4 h-4" />
                </button>
              </div>
              <div v-if="!isEnroll" class="flex justify-end mt-1">
                <a @click="goToResetPass" class="cursor-pointer text-xs text-primary hover:underline transition">
                  {{ t("forgot_password") }}
                </a>
              </div>
            </div>
          </div>
        </SmoothResize>
      </CardContent>

      <CardFooter class="flex flex-col gap-3 pt-4">
        <Button
          v-if="step === 'email'"
          type="submit"
          :disabled="isLoading || stepBusy || !email"
          class="w-full btn-primary"
        >
          <Loader2Icon v-if="isLoading || stepBusy" class="w-4 h-4 mr-2 animate-spin" />
          <template v-else>
            {{ t("continue") }}
            <ArrowRightIcon class="w-4 h-4 ml-2" />
          </template>
        </Button>

        <Button
          v-else
          type="submit"
          :disabled="isLoading"
          class="w-full btn-primary"
        >
          <Loader2Icon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
          <template v-else>
            <LogInIcon class="w-4 h-4 mr-2" />
            {{ t("signin") }}
          </template>
        </Button>

        <p class="text-sm text-muted-foreground text-center">
          {{ t("dont_have_account") }}
          <a @click="props.auth.goToRegister()" class="cursor-pointer text-primary hover:underline transition font-medium">
            {{ t("create_one") }}
          </a>
        </p>

        <button
          v-if="effectiveOfficial"
          type="button"
          @click="props.auth.goToSelfHosted()"
          class="inline-flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <ServerIcon class="w-3.5 h-3.5" />
          {{ t("self_hosted_connect_cta") }}
        </button>
      </CardFooter>
    </form>

    <!-- QR sign-in is scanned by the official Argon mobile app, so it only applies to the official
         instance. On a self-hosted / managed instance it collapses away with a smooth animation. -->
    <Transition name="qr-collapse">
      <div v-if="showQr" class="qr-wrap flex">
        <div class="w-px bg-border/50"></div>

        <div class="flex flex-col justify-center items-center p-6 w-[220px] text-center space-y-4 bg-background/30">
          <div class="icon-box-sm">
            <QrCodeIcon class="w-5 h-5 text-primary" />
          </div>
          <p class="text-sm font-medium text-white">{{ t("qr_code_login") }}</p>
          <QRStyled :value="qrLoginUrl" :size="140" level="M" class="rounded-lg shadow-lg" />
          <p class="text-xs text-muted-foreground">{{ t("scan_with_app") }}</p>
        </div>
      </div>
    </Transition>
  </Card>
</template>

<style scoped>
.login-card {
  @apply rounded-2xl border border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl;
}

.icon-box {
  @apply inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20;
}

.icon-box-sm {
  @apply inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20;
}

.input-styled {
  @apply h-11 rounded-xl bg-background/50 border-border text-white placeholder-muted-foreground
         focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all;
}

.input-group {
  @apply space-y-1;
}

.btn-primary {
  @apply bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70
         text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-300
         active:scale-[0.98];
}

/* Error badge in/out — matches InputWithError. */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

.instance-chip {
  @apply inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
         bg-primary/10 border border-primary/20 text-white;
}

/* QR panel collapse — width + opacity so it slides away smoothly when switching to a
   self-hosted/managed instance. The Card has overflow-hidden, so the card width shrinks cleanly. */
.qr-wrap {
  max-width: 240px;
}

.qr-collapse-enter-active,
.qr-collapse-leave-active {
  transition: max-width 0.32s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.28s ease;
  overflow: hidden;
}

.qr-collapse-enter-from,
.qr-collapse-leave-to {
  max-width: 0;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .qr-collapse-enter-active,
  .qr-collapse-leave-active {
    transition: none;
  }
}
</style>
