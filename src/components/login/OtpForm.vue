<script setup lang="ts">
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@argon/ui/card";
import { Button } from "@argon/ui/button";
import { ReloadIcon } from "@radix-icons/vue";
import { PinInput, PinInputGroup, PinInputInput, PinInputSeparator } from "@argon/ui/pin-input";
import { ArrowBigLeftDashIcon } from "lucide-vue-next";
import { ref } from "vue";
import { useLocale } from "@/store/localeStore";

const { t } = useLocale();
const props = defineProps<{ auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm> }>();
const { otpCode, isLoading, onSubmit, goBackToLogin } = props.auth;

const model = ref([] as string[]);

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
        <Card class="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl p-6">
            <form @submit.prevent="onSubmit" class="flex flex-col h-full">
                <CardHeader class="text-center space-y-1">
                    <CardTitle class="text-2xl font-bold text-white">
                       {{t("enter_your_otp")}}
                    </CardTitle>
                    <CardDescription class="text-gray-400">
                        {{t("we_sent_it_on_email")}}  
                    </CardDescription>
                </CardHeader>

                <CardContent class="flex justify-center pt-6">
                    <PinInput id="pin-input" class="justify-center" v-model="model" placeholder="○"
                        @complete="handleComplete">
                        <PinInputGroup class="gap-1">
                            <template v-for="(id, index) in 6" :key="id">
                                <PinInputInput class="rounded-md border bg-zinc-900" :index="index" />
                                <template v-if="index !== 5">
                                    <PinInputSeparator />
                                </template>
                            </template>
                        </PinInputGroup>
                    </PinInput>
                </CardContent>

                <CardFooter class="mt-6 flex gap-2">
                    <Button type="button" variant="outline" @click="onReturn">
                        <ArrowBigLeftDashIcon />
                    </Button>
                    <Button :disabled="isLoading" class="w-full hover:opacity-90 transition">
                        <ReloadIcon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
                        {{t("verify_and_sigin")}} 
                    </Button>
                </CardFooter>
            </form>
        </Card>
    </div>
</template>
