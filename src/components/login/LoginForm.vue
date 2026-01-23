<script setup lang="ts">
import { Button } from "@argon/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@argon/ui/card";
import { Input } from "@argon/ui/input";
import { Label } from "@argon/ui/label";
import { computed, onMounted, ref, watch } from "vue";
import QRStyled from "./QRStyled.vue";
import { useApi } from "@/store/apiStore";
import { useLocale } from "@/store/localeStore";
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
} from "lucide-vue-next";

const { t } = useLocale();
const props = defineProps<{ auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm> }>();
const { email, password, isLoading, goToResetPass, onSubmit, authError } = props.auth;
const api = useApi();

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
onMounted(() => pickRandomHeading());

const qrLoginUrl = ref("https://www.youtube.com/watch?v=HIcSWuKMwOw");
const step = ref<"email" | "password">("email");
const showPassword = ref(false);

async function getLoginScenario(email: string): Promise<"pwd" | "otp" | "pwd-otp" | ""> {
  const scenario = await api.identityInteraction.GetAuthorizationScenarioFor({ email: email, phone: null, username: null });

  if (!scenario) {
    authError.value = "Account does not exist";
    return "";
  }

  if (scenario == "EmailPassword") return "pwd";
  if (scenario == "EmailPasswordOtp") return "pwd-otp";
  if (scenario == "EmailOtp") return "otp";
  return "pwd";
}

async function handleNext() {
  if (!email.value) return;
  const scenario = await getLoginScenario(email.value);

  if (!scenario) return;

  if (scenario === "pwd") {
    step.value = "password";
  } else if (scenario === "otp") {
    onSubmit();
  }
}

watch(email, (newVal, oldVal) => {
  if (step.value === "password" && newVal !== oldVal) {
    step.value = "email";
  }
});
</script>

<template>
  <div class="flex justify-center items-center min-h-screen">
    <Card class="login-card flex flex-row overflow-hidden">
      <form @submit.prevent="onSubmit" class="w-[400px] flex flex-col">
        <CardHeader class="text-center pb-2">
          <div class="flex justify-center mb-3">
            <div class="icon-box">
              <LogInIcon class="w-6 h-6 text-primary" />
            </div>
          </div>
          <CardTitle class="text-2xl font-bold text-white">{{ heading.title }}</CardTitle>
          <CardDescription class="text-muted-foreground">{{ heading.desc }}</CardDescription>
        </CardHeader>

        <CardContent class="space-y-4 pt-4 flex-1">
          <Transition name="slide" mode="out-in">
            <div v-if="step === 'email'" key="email-step" class="space-y-4">
              <div class="input-group">
                <div class="flex items-center gap-2 mb-2">
                  <MailIcon class="w-4 h-4 text-primary" />
                  <Label for="email" class="text-sm font-medium">Email</Label>
                </div>
                <div class="relative">
                  <InputWithError 
                    v-model="email" 
                    :error="authError" 
                    @clear-error="authError = ''" 
                    type="email"
                    placeholder="example@email.com" 
                    :disabled="isLoading" 
                    id="email"
                    class="input-styled pl-10"
                  />
                  <MailIcon class="absolute left-3 top-[14px] w-4 h-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>

            <div v-else key="password-step" class="space-y-4">
              <div class="input-group">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <MailIcon class="w-4 h-4 text-primary" />
                    <Label class="text-sm font-medium">Email</Label>
                  </div>
                  <button type="button" @click="step = 'email'" class="text-xs text-primary hover:underline">
                    {{ t("change") }}
                  </button>
                </div>
                <div class="px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground">
                  {{ email }}
                </div>
              </div>

              <div class="input-group">
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
                    class="input-styled pl-10 pr-10"
                    :disabled="isLoading" 
                  />
                  <LockIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <button 
                    type="button" 
                    @click="showPassword = !showPassword"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors"
                  >
                    <EyeOffIcon v-if="showPassword" class="w-4 h-4" />
                    <EyeIcon v-else class="w-4 h-4" />
                  </button>
                </div>
                <div class="flex justify-end mt-1">
                  <a @click="goToResetPass" class="cursor-pointer text-xs text-primary hover:underline transition">
                    {{ t("forgot_password") }}
                  </a>
                </div>
              </div>
            </div>
          </Transition>
        </CardContent>

        <CardFooter class="flex flex-col gap-3 pt-2">
          <Button 
            v-if="step === 'email'" 
            type="button" 
            :disabled="isLoading || !email"
            class="w-full btn-primary" 
            @click="handleNext"
          >
            <Loader2Icon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
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
        </CardFooter>
      </form>

      <div class="w-px bg-border/50"></div>

      <div class="flex flex-col justify-center items-center p-6 w-[220px] text-center space-y-4 bg-background/30">
        <div class="icon-box-sm">
          <QrCodeIcon class="w-5 h-5 text-primary" />
        </div>
        <p class="text-sm font-medium text-white">{{ t("qr_code_login") }}</p>
        <QRStyled :value="qrLoginUrl" :size="140" level="M" class="rounded-lg shadow-lg" />
        <p class="text-xs text-muted-foreground">{{ t("scan_with_app") }}</p>
      </div>
    </Card>
  </div>
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
         text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-300;
}

/* Slide transition */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.slide-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
</style>
