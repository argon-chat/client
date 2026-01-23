<script setup lang="ts">
import { Button } from "@argon/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@argon/ui/card";
import { Input } from "@argon/ui/input";
import { Label } from "@argon/ui/label";
import { Checkbox } from "@argon/ui/checkbox";
import { DatePicker } from "@argon/ui/date-picker";
import { 
    MailIcon, 
    UserIcon, 
    LockIcon, 
    CalendarIcon, 
    CheckIcon, 
    ArrowRightIcon, 
    ArrowLeftIcon,
    SparklesIcon,
    ShieldCheckIcon,
    Loader2Icon,
    EyeIcon,
    EyeOffIcon,
    AtSignIcon,
} from "lucide-vue-next";
import { useLocale } from "@/store/localeStore";
import { today, getLocalTimeZone } from "@internationalized/date";
import { ref, computed, watch } from "vue";

const { t } = useLocale();
const props = defineProps<{
    auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm>;
}>();

const {
    email,
    password,
    username,
    displayName,
    allowSendMeOptionalEmails,
    agreeTos,
    isLoading,
    brithDate,
    onSubmit,
} = props.auth;

// Step management
const currentStep = ref(1);
const totalSteps = 3;
const showPassword = ref(false);

// Step validation
const isStep1Valid = computed(() => email.value && displayName.value);
const isStep2Valid = computed(() => username.value && password.value && password.value.length >= 8);
const isStep3Valid = computed(() => brithDate.value && agreeTos.value);

const canProceed = computed(() => {
    if (currentStep.value === 1) return isStep1Valid.value;
    if (currentStep.value === 2) return isStep2Valid.value;
    if (currentStep.value === 3) return isStep3Valid.value;
    return false;
});

// Password strength
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

// Visual bar width by category (not raw percentage)
const passwordStrengthWidth = computed(() => {
    if (!password.value) return 0;
    if (passwordStrength.value < 30) return 25;
    if (passwordStrength.value < 60) return 50;
    if (passwordStrength.value < 80) return 75;
    return 100;
});

function nextStep() {
    if (currentStep.value < totalSteps && canProceed.value) {
        currentStep.value++;
    }
}

function prevStep() {
    if (currentStep.value > 1) {
        currentStep.value--;
    }
}

function handleSubmit() {
    if (currentStep.value === totalSteps && canProceed.value) {
        onSubmit();
    } else if (canProceed.value) {
        nextStep();
    }
}

// Steps config
const steps = computed(() => [
    { 
        id: 1, 
        title: t("account_basics"),
        icon: MailIcon,
        completed: isStep1Valid.value && currentStep.value > 1
    },
    { 
        id: 2, 
        title: t("identity"),
        icon: UserIcon,
        completed: isStep2Valid.value && currentStep.value > 2
    },
    { 
        id: 3, 
        title: t("finish_up"),
        icon: ShieldCheckIcon,
        completed: false
    },
]);
</script>

<template>
    <div class="flex justify-center items-center min-h-screen">
        <form @submit.prevent="handleSubmit" class="w-full max-w-[500px]">
            <Card class="register-card">
                <!-- Header inside card -->
                <CardHeader class="text-center pb-2">
                    <div class="flex justify-center mb-3">
                        <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                            <SparklesIcon class="w-6 h-6 text-primary" />
                        </div>
                    </div>
                    <CardTitle class="text-2xl font-bold text-white">{{ t("create_account") }}</CardTitle>
                    <CardDescription class="text-muted-foreground">{{ t("join_argon") }}</CardDescription>
                </CardHeader>

                <!-- Progress Steps inside card -->
                <div class="flex items-center justify-between px-6 pb-4">
                    <template v-for="(step, index) in steps" :key="step.id">
                        <div class="flex items-center gap-1.5">
                            <div 
                                class="step-indicator"
                                :class="{
                                    'step-active': currentStep === step.id,
                                    'step-completed': step.completed,
                                    'step-pending': currentStep < step.id && !step.completed
                                }"
                            >
                                <CheckIcon v-if="step.completed" class="w-3.5 h-3.5" />
                                <component v-else :is="step.icon" class="w-3.5 h-3.5" />
                            </div>
                            <span 
                                class="text-xs font-medium hidden sm:block transition-colors"
                                :class="currentStep >= step.id ? 'text-white' : 'text-muted-foreground'"
                            >
                                {{ step.title }}
                            </span>
                        </div>
                        <div 
                            v-if="index < steps.length - 1" 
                            class="flex-1 h-0.5 mx-2 rounded-full transition-colors"
                            :class="currentStep > step.id ? 'bg-primary' : 'bg-border'"
                        />
                    </template>
                </div>

                <CardContent class="pt-2">
                        <!-- Step 1: Email & Display Name -->
                        <Transition name="slide" mode="out-in">
                            <div v-if="currentStep === 1" key="step1" class="space-y-5">
                                <div class="input-group">
                                    <div class="flex items-center gap-2 mb-2">
                                        <MailIcon class="w-4 h-4 text-primary" />
                                        <Label for="email" class="text-sm font-medium">Email</Label>
                                    </div>
                                    <div class="relative">
                                        <Input 
                                            id="email" 
                                            v-model="email" 
                                            type="email" 
                                            placeholder="example@email.com" 
                                            class="input-styled pl-10"
                                            :disabled="isLoading" 
                                        />
                                        <MailIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    </div>
                                    <p class="text-xs text-muted-foreground mt-1.5">{{ t("email_hint") }}</p>
                                </div>

                                <div class="input-group">
                                    <div class="flex items-center gap-2 mb-2">
                                        <UserIcon class="w-4 h-4 text-primary" />
                                        <Label for="displayName" class="text-sm font-medium">{{ t("display_name") }}</Label>
                                    </div>
                                    <div class="relative">
                                        <Input 
                                            id="displayName" 
                                            v-model="displayName" 
                                            type="text" 
                                            placeholder="John Doe" 
                                            class="input-styled pl-10"
                                            :disabled="isLoading" 
                                        />
                                        <UserIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    </div>
                                    <p class="text-xs text-muted-foreground mt-1.5">{{ t("display_name_hint") }}</p>
                                </div>
                            </div>

                            <!-- Step 2: Username & Password -->
                            <div v-else-if="currentStep === 2" key="step2" class="space-y-5">
                                <div class="input-group">
                                    <div class="flex items-center gap-2 mb-2">
                                        <AtSignIcon class="w-4 h-4 text-primary" />
                                        <Label for="username" class="text-sm font-medium">{{ t("username") }}</Label>
                                    </div>
                                    <div class="relative">
                                        <Input 
                                            id="username" 
                                            v-model="username" 
                                            type="text" 
                                            placeholder="username" 
                                            class="input-styled pl-10"
                                            :disabled="isLoading" 
                                        />
                                        <AtSignIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    </div>
                                    <p class="text-xs text-muted-foreground mt-1.5">{{ t("username_hint") }}</p>
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
                                    
                                    <!-- Password strength indicator - always visible, content changes -->
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
                            </div>

                            <!-- Step 3: Birth Date & Terms -->
                            <div v-else-if="currentStep === 3" key="step3" class="space-y-5">
                                <div class="input-group">
                                    <div class="flex items-center gap-2 mb-2">
                                        <CalendarIcon class="w-4 h-4 text-primary" />
                                        <Label class="text-sm font-medium">{{ t("dob") }}</Label>
                                    </div>
                                    <DatePicker 
                                        v-model="brithDate" 
                                        :placeholder="t('dob')" 
                                        :max-value="today(getLocalTimeZone()).subtract({ years: 14 })"
                                        :disabled="isLoading" 
                                        :date-format="{ year: 'numeric', month: '2-digit', day: '2-digit' }"
                                        clearable
                                        class="input-styled w-full" 
                                    />
                                    <p class="text-xs text-muted-foreground mt-1.5">{{ t("dob_hint") }}</p>
                                </div>

                                <!-- Agreements section -->
                                <div class="space-y-3 pt-2">
                                    <div class="agreement-item">
                                        <Checkbox 
                                            v-model:checked="allowSendMeOptionalEmails" 
                                            id="allowSendMeOptionalEmails" 
                                        />
                                        <label for="allowSendMeOptionalEmails" class="text-sm text-muted-foreground cursor-pointer">
                                            {{ t("recive_emails_and_news") }}
                                        </label>
                                    </div>

                                    <div class="agreement-item border border-primary/20 bg-primary/5 rounded-lg p-3">
                                        <Checkbox 
                                            v-model:checked="agreeTos" 
                                            aria-required="true" 
                                            id="agreeTos" 
                                        />
                                        <label for="agreeTos" class="text-sm cursor-pointer">
                                            {{ t("accept") }}
                                            <a href="/tos" class="text-primary hover:underline">{{ t("terms") }}</a>
                                            {{ t("and") }}
                                            <a href="/privacy" class="text-primary hover:underline">{{ t("privacy_policy") }}</a>
                                            <span class="text-red-400">*</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </Transition>
                    </CardContent>

                    <CardFooter class="flex flex-col gap-4 p-6 pt-0">
                        <!-- Navigation buttons -->
                        <div class="flex gap-3 w-full">
                            <Button 
                                v-if="currentStep > 1"
                                type="button" 
                                variant="outline" 
                                @click="prevStep"
                                :disabled="isLoading"
                                class="flex-1"
                            >
                                <ArrowLeftIcon class="w-4 h-4 mr-2" />
                                {{ t("back") }}
                            </Button>
                            
                            <Button 
                                type="submit"
                                :disabled="!canProceed || isLoading" 
                                class="flex-1 btn-primary"
                            >
                                <Loader2Icon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
                                <template v-else-if="currentStep === totalSteps">
                                    <SparklesIcon class="w-4 h-4 mr-2" />
                                    {{ t("register") }}
                                </template>
                                <template v-else>
                                    {{ t("continue") }}
                                    <ArrowRightIcon class="w-4 h-4 ml-2" />
                                </template>
                            </Button>
                        </div>

                        <!-- Login link -->
                        <p class="text-sm text-muted-foreground text-center">
                            {{ t("already_have_account") }}
                            <a 
                                @click="props.auth.goBackToLogin()"
                                class="cursor-pointer text-primary hover:underline transition font-medium"
                            >
                                {{ t("signin") }}
                            </a>
                        </p>
                    </CardFooter>
                </Card>
            </form>
    </div>
</template>

<style scoped>
.register-card {
    @apply rounded-2xl border border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl overflow-hidden;
}

.input-styled {
    @apply h-11 rounded-xl bg-background/50 border-border text-white placeholder-muted-foreground
           focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all;
}

.input-group {
    @apply space-y-1;
}

.step-indicator {
    @apply w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 border-2;
}

.step-active {
    @apply bg-primary/20 border-primary text-primary;
}

.step-completed {
    @apply bg-primary border-primary text-primary-foreground;
}

.step-pending {
    @apply bg-background/50 border-border text-muted-foreground;
}

.agreement-item {
    @apply flex gap-3 items-start;
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
