<script setup lang="ts">
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@argon/ui/card";
import { Button } from "@argon/ui/button";
import { Input } from "@argon/ui/input";
import { Label } from "@argon/ui/label";
import { PinInput, PinInputGroup, PinInputInput, PinInputSeparator } from "@argon/ui/pin-input";
import { useLocale } from "@/store/localeStore";
import { 
    KeyRoundIcon, 
    ArrowLeftIcon, 
    LockIcon,
    Loader2Icon,
    CheckCircleIcon,
    EyeIcon,
    EyeOffIcon,
} from "lucide-vue-next";
import { ref, computed } from "vue";

const { t } = useLocale();
const props = defineProps<{ auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm> }>();
const { otpCode, password, isLoading, onSubmit, goBackToLogin } = props.auth;

const model = ref([] as string[]);
const showPassword = ref(false);

const isCodeComplete = computed(() => model.value.length === 6 && model.value.every(v => v));

function handleComplete(e: string[]) {
    otpCode.value = e.join("");
}

function onReturn() {
    otpCode.value = "";
    goBackToLogin();
}

// Password strength (reused from register)
const passwordStrength = computed(() => {
    if (!password.value) return 0;
    let strength = 0;
    if (password.value.length >= 8) strength += 25;
    if (password.value.length >= 12) strength += 15;
    if (/[a-z]/.test(password.value)) strength += 15;
    if (/[A-Z]/.test(password.value)) strength += 15;
    if (/[0-9]/.test(password.value)) strength += 15;
    if (/[^a-zA-Z0-9]/.test(password.value)) strength += 15;
    return Math.min(strength, 100);
});

const passwordStrengthLabel = computed(() => {
    if (passwordStrength.value < 30) return { text: t("weak"), color: "text-red-400" };
    if (passwordStrength.value < 60) return { text: t("medium"), color: "text-yellow-400" };
    if (passwordStrength.value < 80) return { text: t("strong"), color: "text-green-400" };
    return { text: t("very_strong"), color: "text-emerald-400" };
});

const passwordStrengthColor = computed(() => {
    if (passwordStrength.value < 30) return "bg-red-500";
    if (passwordStrength.value < 60) return "bg-yellow-500";
    if (passwordStrength.value < 80) return "bg-green-500";
    return "bg-emerald-500";
});

const passwordStrengthWidth = computed(() => {
    if (!password.value) return 0;
    if (passwordStrength.value < 30) return 25;
    if (passwordStrength.value < 60) return 50;
    if (passwordStrength.value < 80) return 75;
    return 100;
});
</script>

<template>
  <div class="flex justify-center items-center min-h-screen">
    <form @submit.prevent="onSubmit" class="w-full max-w-[420px]">
      <Card class="reset-card">
        <CardHeader class="text-center pb-2">
          <div class="flex justify-center mb-3">
            <div class="icon-box">
              <KeyRoundIcon class="w-6 h-6 text-primary" />
            </div>
          </div>
          <CardTitle class="text-2xl font-bold text-white">{{ t("enter_reset_code") }}</CardTitle>
          <CardDescription class="text-muted-foreground">{{ t("sent_on_email") }}</CardDescription>
        </CardHeader>

        <CardContent class="pt-4 space-y-5">
          <!-- OTP Code Input -->
          <div class="input-group">
            <div class="flex items-center gap-2 mb-3">
              <CheckCircleIcon class="w-4 h-4 text-primary" />
              <Label class="text-sm font-medium">{{ t("verification_code") }}</Label>
            </div>
            <div class="flex justify-center">
              <PinInput 
                id="reset-code" 
                v-model="model" 
                placeholder="○" 
                @complete="handleComplete"
                class="gap-2"
              >
                <PinInputGroup class="gap-2">
                  <template v-for="(id, index) in 6" :key="id">
                    <PinInputInput 
                      class="pin-input" 
                      :index="index" 
                    />
                    <PinInputSeparator v-if="index === 2" class="text-muted-foreground">-</PinInputSeparator>
                  </template>
                </PinInputGroup>
              </PinInput>
            </div>
          </div>

          <!-- New Password -->
          <div class="input-group">
            <div class="flex items-center gap-2 mb-2">
              <LockIcon class="w-4 h-4 text-primary" />
              <Label for="new-password" class="text-sm font-medium">{{ t("new_password") }}</Label>
            </div>
            <div class="relative">
              <Input 
                id="new-password" 
                v-model="password" 
                :type="showPassword ? 'text' : 'password'" 
                :disabled="isLoading" 
                class="input-styled pl-10 pr-10" 
                placeholder="••••••••" 
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
            
            <!-- Password strength indicator -->
            <div class="mt-3 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted-foreground">{{ t("password_strength") }}</span>
                <span :class="password ? passwordStrengthLabel.color : 'text-muted-foreground/50'" class="font-medium transition-colors">
                  {{ password ? passwordStrengthLabel.text : '—' }}
                </span>
              </div>
              <div class="h-1.5 bg-background/50 rounded-full overflow-hidden">
                <div 
                  class="h-full transition-all duration-300 rounded-full"
                  :class="password ? passwordStrengthColor : 'bg-muted-foreground/20'"
                  :style="{ width: `${passwordStrengthWidth}%` }"
                />
              </div>
            </div>
          </div>
        </CardContent>

        <CardFooter class="flex flex-col gap-3 pt-2">
          <div class="flex gap-3 w-full">
            <Button type="button" variant="outline" @click="onReturn" :disabled="isLoading" class="px-4">
              <ArrowLeftIcon class="w-4 h-4" />
            </Button>
            <Button 
              :disabled="isLoading || !isCodeComplete || !password" 
              class="flex-1 btn-primary"
            >
              <Loader2Icon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
              <template v-else>
                <KeyRoundIcon class="w-4 h-4 mr-2" />
                {{ t("reset_password") }}
              </template>
            </Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  </div>
</template>

<style scoped>
.reset-card {
  @apply rounded-2xl border border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl overflow-hidden;
}

.icon-box {
  @apply inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20;
}

.input-styled {
  @apply h-11 rounded-xl bg-background/50 border-border text-white placeholder-muted-foreground
         focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all;
}

.input-group {
  @apply space-y-1;
}

.pin-input {
  @apply w-11 h-12 rounded-lg border border-border bg-background/50 text-center text-lg font-semibold text-white
         focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all;
}

.btn-primary {
  @apply bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 
         text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-300;
}
</style>
