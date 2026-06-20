<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import { Button } from "@argon/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@argon/ui/card";
import { Label } from "@argon/ui/label";
import InputWithError from "../shared/InputWithError.vue";
import BorderTrace from "../shared/BorderTrace.vue";
import { useLocale } from "@/store/system/localeStore";
import { useInstance, InstanceError, type InstanceErrorKind } from "@/store/system/instanceStore";
import { ServerIcon, Loader2Icon, ArrowLeftIcon, ArrowRightIcon } from "lucide-vue-next";

const { t } = useLocale();
const props = defineProps<{ auth: ReturnType<typeof import("@/composables/useAuthForm").useAuthForm> }>();
const instance = useInstance();

const endpoint = ref("");
const isLoading = ref(false);
const error = ref("");
const formEl = ref<HTMLFormElement | null>(null);
// Bumped on each new error to replay the BorderTrace error pulse (matches LoginForm).
const traceKey = ref(0);

onMounted(() => nextTick(() => formEl.value?.querySelector<HTMLInputElement>("input")?.focus()));

function errCopy(kind: InstanceErrorKind): string {
  switch (kind) {
    case "not-argon": return t("self_hosted_err_not_argon");
    case "invalid-schema": return t("self_hosted_err_invalid_schema");
    case "version-gate": return t("self_hosted_err_version_gate");
    case "insecure-http": return t("self_hosted_err_insecure_http");
    case "unreachable":
    default: return t("self_hosted_err_unreachable");
  }
}

async function connect() {
  if (!endpoint.value.trim() || isLoading.value) return;
  isLoading.value = true;
  error.value = "";
  try {
    const manifest = await instance.fetchManifest(endpoint.value);
    // Primary: re-points the global instance reactively. Enroll: stashes the target locally so the
    // live session is untouched. Either way we drop back into the login form bound to this instance.
    await props.auth.applyManifestFromSelfHosted(manifest);
    props.auth.goBackToLogin();
  } catch (e) {
    error.value = e instanceof InstanceError ? errCopy(e.kind) : t("self_hosted_err_unreachable");
    traceKey.value++;
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <Card class="login-card relative flex flex-col overflow-hidden w-[400px]">
    <BorderTrace v-if="traceKey > 0" :key="traceKey" />

    <form ref="formEl" @submit.prevent="connect" novalidate class="flex flex-col justify-center">
      <CardHeader class="text-center pb-2">
        <div class="flex justify-center mb-3">
          <div class="icon-box">
            <ServerIcon class="w-6 h-6 text-primary" />
          </div>
        </div>
        <CardTitle class="text-2xl font-bold text-white">{{ t("self_hosted_title") }}</CardTitle>
        <CardDescription class="text-muted-foreground">{{ t("self_hosted_desc") }}</CardDescription>
      </CardHeader>

      <CardContent class="pt-4">
        <div class="input-group">
          <div class="flex items-center gap-2 mb-2">
            <ServerIcon class="w-4 h-4 text-primary" />
            <Label for="endpoint" class="text-sm font-medium">{{ t("self_hosted_endpoint_label") }}</Label>
          </div>
          <InputWithError
            v-model="endpoint"
            :error="error"
            @clear-error="error = ''"
            type="text"
            inputmode="url"
            :placeholder="t('self_hosted_endpoint_placeholder')"
            :disabled="isLoading"
            id="endpoint"
          />
        </div>
      </CardContent>

      <CardFooter class="flex flex-col gap-3 pt-4">
        <Button type="submit" :disabled="isLoading || !endpoint.trim()" class="w-full btn-primary">
          <Loader2Icon v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
          <template v-else>
            {{ t("self_hosted_connect") }}
            <ArrowRightIcon class="w-4 h-4 ml-2" />
          </template>
        </Button>

        <button
          type="button"
          @click="props.auth.goBackToLogin()"
          class="inline-flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-white transition-colors"
        >
          <ArrowLeftIcon class="w-4 h-4" />
          {{ t("self_hosted_back") }}
        </button>
      </CardFooter>
    </form>
  </Card>
</template>

<style scoped>
.login-card {
  @apply rounded-2xl border border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl;
}

.icon-box {
  @apply inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20;
}

.input-group {
  @apply space-y-1;
}

.btn-primary {
  @apply bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70
         text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-300
         active:scale-[0.98];
}
</style>
