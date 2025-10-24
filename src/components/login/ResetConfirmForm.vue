<script setup lang="ts">
import Card from "../ui/card/Card.vue";
import CardContent from "../ui/card/CardContent.vue";
import CardFooter from "../ui/card/CardFooter.vue";
import CardHeader from "../ui/card/CardHeader.vue";
import CardTitle from "../ui/card/CardTitle.vue";
import CardDescription from "../ui/card/CardDescription.vue";
import Button from "../ui/button/Button.vue";
import Input from "../ui/input/Input.vue";
import Label from "../ui/label/Label.vue";
import { ReloadIcon } from "@radix-icons/vue";
import { PinInput, PinInputGroup, PinInputInput, PinInputSeparator } from "@/components/ui/pin-input";
import { useLocale } from "@/store/localeStore";
import { ArrowBigLeftDashIcon } from "lucide-vue-next";
import { ref } from "vue";

const { t } = useLocale();
const props = defineProps<{ auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm> }>();
const { otpCode, password, isLoading, onSubmit, goBackToLogin } = props.auth;

const model = ref([] as string[]);

function handleComplete(e: string[]) {
    otpCode.value = e.join("");
}

function onReturn() {
    otpCode.value = "";
    goBackToLogin();
}
</script>

<template>
  <div class="flex justify-center items-center min-h-screen">
    <Card class="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl p-6 w-full max-w-md">
      <form @submit.prevent="onSubmit" class="flex flex-col h-full">
        <CardHeader class="text-center space-y-1">
          <CardTitle class="text-2xl font-bold text-white">
            {{ t("enter_reset_code") }}
          </CardTitle>
          <CardDescription class="text-gray-400">
            {{ t("sent_on_email") }}
          </CardDescription>
        </CardHeader>

        <CardContent class="flex flex-col gap-4 pt-6">
          <div class="flex justify-center">
            <PinInput id="reset-code" class="justify-center" v-model="model" placeholder="○" @complete="handleComplete">
              <PinInputGroup class="gap-1">
                <template v-for="(id, index) in 6" :key="id">
                  <PinInputInput class="rounded-md border bg-zinc-900" :index="index" />
                  <template v-if="index !== 5">
                    <PinInputSeparator />
                  </template>
                </template>
              </PinInputGroup>
            </PinInput>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="password" class="text-gray-300">{{ t("password") }} *</Label>
            <Input id="password" v-model="password" type="password" :disabled="isLoading" class="bg-zinc-900 border border-zinc-700 text-white placeholder-gray-500" placeholder="Enter new password" />
          </div>
        </CardContent>

        <CardFooter class="mt-6 flex gap-2">
          <Button type="button" variant="outline" @click="onReturn">
            <ArrowBigLeftDashIcon />
          </Button>
          <Button :disabled="isLoading" class="w-full hover:opacity-90 transition">
            <ReloadIcon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
            {{ t("reset_password") }}
          </Button>
        </CardFooter>
      </form>
    </Card>
  </div>
</template>
