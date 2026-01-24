<script setup lang="ts">
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@argon/ui/card";
import { Input } from "@argon/ui/input";
import { Label } from "@argon/ui/label";
import { Button } from "@argon/ui/button";
import { 
    MailIcon, 
    KeyRoundIcon,
    ArrowLeftIcon,
    Loader2Icon,
    SendIcon,
} from "lucide-vue-next";
import { useLocale } from "@/store/localeStore";

const { t } = useLocale();
const props = defineProps<{ auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm> }>();

const { email, isLoading, onSubmit, goBackToLogin } = props.auth;
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
          <CardTitle class="text-2xl font-bold text-white">{{ t("reset_password") }}</CardTitle>
          <CardDescription class="text-muted-foreground">{{ t("we_will_send_reset_code") }}</CardDescription>
        </CardHeader>

        <CardContent class="pt-4">
          <div class="input-group">
            <div class="flex items-center gap-2 mb-2">
              <MailIcon class="w-4 h-4 text-primary" />
              <Label for="reset-email" class="text-sm font-medium">Email</Label>
            </div>
            <div class="relative">
              <Input 
                id="reset-email" 
                v-model="email" 
                type="email" 
                placeholder="example@email.com"
                class="input-styled pl-10"
                :disabled="isLoading" 
              />
              <MailIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            </div>
            <p class="text-xs text-muted-foreground mt-1.5">{{ t("reset_email_hint") }}</p>
          </div>
        </CardContent>

        <CardFooter class="flex flex-col gap-3 pt-2">
          <div class="flex gap-3 w-full">
            <Button type="button" variant="outline" @click="goBackToLogin" :disabled="isLoading" class="px-4">
              <ArrowLeftIcon class="w-4 h-4" />
            </Button>
            <Button :disabled="isLoading || !email" class="flex-1 btn-primary">
              <Loader2Icon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
              <template v-else>
                <SendIcon class="w-4 h-4 mr-2" />
                {{ t("send_code") }}
              </template>
            </Button>
          </div>
          
          <p class="text-sm text-muted-foreground text-center">
            {{ t("remember_password") }}
            <a @click="goBackToLogin" class="cursor-pointer text-primary hover:underline transition font-medium">
              {{ t("signin") }}
            </a>
          </p>
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

.btn-primary {
  @apply bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 
         text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-300;
}
</style>
