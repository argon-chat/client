<script setup lang="ts">
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ReloadIcon } from "@radix-icons/vue";
import { ArrowBigLeftDashIcon } from "lucide-vue-next";
import { useLocale } from "@/store/localeStore";

const { t } = useLocale();
const props = defineProps<{ auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm> }>();

const { email, isLoading, onSubmit, goBackToLogin } = props.auth;
</script>

<template>
  <form @submit.prevent="onSubmit">
    <Card>
      <CardHeader>
        <CardTitle>{{t("enter_email") }}</CardTitle>
        <CardDescription>{{t("we_will_send_reset_code")}}</CardDescription>
      </CardHeader>
      <CardContent>
        <Label>Email *</Label>
        <Input v-model="email" type="email" :disabled="isLoading" />
      </CardContent>
      <CardFooter class="flex gap-2">
        <Button type="button" variant="outline" @click="goBackToLogin">
          <ArrowBigLeftDashIcon/>
        </Button>
        <Button :disabled="isLoading" class="flex-1">
          <ReloadIcon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
          {{ t("reset_password") }}
        </Button>
      </CardFooter>
    </Card>
  </form>
</template>
