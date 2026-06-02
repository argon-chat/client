<script setup lang="ts">
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@argon/ui/card";
import { Button } from "@argon/ui/button";
import { PinInput, PinInputGroup, PinInputInput, PinInputSeparator } from "@argon/ui/pin-input";
import {
    ArrowLeftIcon,
    ShieldCheckIcon,
    Loader2Icon,
    MailCheckIcon,
} from "lucide-vue-next";
import { ExclamationTriangleIcon } from "@radix-icons/vue";
import BorderTrace from "../shared/BorderTrace.vue";
import { ref, computed, watch } from "vue";
import { useLocale } from "@/store/system/localeStore";

const { t } = useLocale();
const props = defineProps<{ auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm> }>();
const { otpCode, isLoading, onSubmit, goBackToLogin, authError } = props.auth;

const model = ref([] as string[]);
const traceKey = ref(0);

const isCodeComplete = computed(() => model.value.length === 6 && model.value.every(v => v));

// Pulse the border on a new error; clear it once the user edits the code.
watch(authError, (v, prev) => {
    if (v && !prev) traceKey.value++;
});
watch(model, () => {
    if (authError.value) authError.value = "";
}, { deep: true });

function handleComplete(e: string[]) {
    otpCode.value = e.join("");
    onSubmit();
}

function onReturn() {
    otpCode.value = "";
    goBackToLogin();
}
</script>

<template>
    <div class="flex justify-center items-center">
        <form @submit.prevent="onSubmit" novalidate class="w-[420px] max-w-full">
            <Card class="otp-card relative">
                <BorderTrace v-if="traceKey > 0" :key="traceKey" />
                <CardHeader class="text-center pb-2">
                    <div class="flex justify-center mb-3">
                        <div class="icon-box">
                            <ShieldCheckIcon class="w-6 h-6 text-primary" />
                        </div>
                    </div>
                    <CardTitle class="text-2xl font-bold text-white">{{ t("enter_your_otp") }}</CardTitle>
                    <CardDescription class="text-muted-foreground">{{ t("we_sent_it_on_email") }}</CardDescription>
                </CardHeader>

                <CardContent class="pt-4">
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

                        <div class="flex items-center justify-center gap-2 mb-4">
                            <MailCheckIcon class="w-4 h-4 text-primary" />
                            <span class="text-sm font-medium text-muted-foreground">{{ t("verification_code") }}</span>
                        </div>
                        <div class="flex justify-center">
                            <PinInput 
                                id="pin-input" 
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
                        <p class="text-xs text-muted-foreground text-center mt-4">{{ t("otp_hint") }}</p>
                    </div>
                </CardContent>

                <CardFooter class="flex flex-col gap-3 pt-2">
                    <div class="flex gap-3 w-full">
                        <Button type="button" variant="outline" @click="onReturn" :disabled="isLoading" class="px-4">
                            <ArrowLeftIcon class="w-4 h-4" />
                        </Button>
                        <Button 
                            :disabled="isLoading || !isCodeComplete" 
                            class="flex-1 btn-primary"
                        >
                            <Loader2Icon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
                            <template v-else>
                                <ShieldCheckIcon class="w-4 h-4 mr-2" />
                                {{ t("verify_and_sigin") }}
                            </template>
                        </Button>
                    </div>
                </CardFooter>
            </Card>
        </form>
    </div>
</template>

<style scoped>
.otp-card {
    @apply rounded-2xl border border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl overflow-hidden;
}

.icon-box {
    @apply inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20;
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
</style>
