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
import { ref, computed } from "vue";
import { useLocale } from "@/store/localeStore";

const { t } = useLocale();
const props = defineProps<{ auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm> }>();
const { otpCode, isLoading, onSubmit, goBackToLogin } = props.auth;

const model = ref([] as string[]);

const isCodeComplete = computed(() => model.value.length === 6 && model.value.every(v => v));

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
    <div class="flex justify-center items-center min-h-screen">
        <form @submit.prevent="onSubmit" class="w-full max-w-[420px]">
            <Card class="otp-card">
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
                    <div class="input-group">
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
</style>
