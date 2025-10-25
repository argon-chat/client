<script setup lang="ts">
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ReloadIcon } from "@radix-icons/vue";
import { PinInput, PinInputGroup, PinInputInput, PinInputSeparator } from "@/components/ui/pin-input";
import { useLocale } from "@/store/localeStore";

const { t } = useLocale();
const props = defineProps<{ auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm> }>();

const { otpCode, password, isLoading, onSubmit } = props.auth;

function handleComplete(e: string[]) {
    otpCode.value = e.join("");
}
</script>

<template>
    <form @submit.prevent="onSubmit">
        <Card>
            <CardHeader>
                <CardTitle>{{t("enter_reset_code")}}</CardTitle>
                <CardDescription>{{t("sent_on_email")}}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-2">
                <PinInput @complete="handleComplete">
                    <PinInputGroup class="gap-1">
                        <template v-for="index in 6" :key="index">
                            <PinInputInput :index="index - 1" class="rounded-md border bg-zinc-900" />
                            <template v-if="index !== 6">
                                <PinInputSeparator />
                            </template>
                        </template>
                    </PinInputGroup>
                </PinInput>
                <Label>{{t("password")}} *</Label>
                <Input v-model="password" type="password" :disabled="isLoading" />
            </CardContent>
            <CardFooter>
                <Button :disabled="isLoading" class="w-full">
                    <ReloadIcon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
                    {{t("reset_password")}}
                </Button>
            </CardFooter>
        </Card>
    </form>
</template>
