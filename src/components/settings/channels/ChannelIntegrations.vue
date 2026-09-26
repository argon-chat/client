<template>
  <div class="space-y-6">
    <div class="setting-card space-y-5">
      <div class="flex items-start gap-2 min-w-0">
        <WebhookIcon class="w-5 h-5 mt-0.5 shrink-0" />
        <div class="min-w-0">
          <h3 class="text-lg font-semibold leading-tight">{{ t("webhooks") }}</h3>
          <p class="text-xs text-muted-foreground mt-1">{{ t("webhooks_desc") }}</p>
        </div>
      </div>

      <!-- The URL, shown once after a create or a new token -->
      <div v-if="revealed" class="webhook-reveal space-y-3" data-testid="webhook-reveal">
        <p class="text-sm font-medium">{{ t("webhook_url_title") }} · {{ revealed.name }}</p>
        <div class="flex gap-2">
          <Input
            :model-value="revealed.url"
            readonly
            class="font-mono text-xs"
            data-testid="webhook-url"
            @focus="(e: FocusEvent) => (e.target as HTMLInputElement | null)?.select()" />
          <Button variant="outline" class="shrink-0" data-testid="webhook-copy" @click="copyUrl">
            <CopyIcon class="w-4 h-4 mr-2" />
            {{ t("webhook_copy_url") }}
          </Button>
        </div>
        <p class="flex items-start gap-1.5 text-xs text-amber-500">
          <TriangleAlertIcon class="w-3.5 h-3.5 mt-px shrink-0" />
          <span>{{ t("webhook_url_warning") }}</span>
        </p>
        <div class="flex justify-end">
          <Button size="sm" data-testid="webhook-reveal-done" @click="dismissReveal">{{ t("webhook_done") }}</Button>
        </div>
      </div>

      <!-- Create -->
      <form class="flex gap-2" @submit.prevent="onCreate">
        <Input
          v-model="newName"
          :maxlength="MAX_WEBHOOK_NAME_LENGTH"
          :placeholder="t('webhook_name_placeholder')"
          :disabled="atLimit"
          data-testid="webhook-new-name" />
        <Button type="submit" class="shrink-0" :disabled="busy || atLimit || !newName.trim()" data-testid="webhook-create">
          <PlusIcon class="w-4 h-4 mr-2" />
          {{ t("webhook_create") }}
        </Button>
      </form>
      <p v-if="atLimit" class="text-xs text-muted-foreground" data-testid="webhook-limit">
        {{ t("webhook_limit_reached", { max: MAX_WEBHOOKS_PER_CHANNEL }) }}
      </p>

      <!-- List -->
      <div v-if="loading && !webhooks.length" class="flex justify-center py-4">
        <Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
      <p v-else-if="!webhooks.length" class="text-sm text-muted-foreground" data-testid="webhooks-empty">
        {{ t("webhooks_empty") }}
      </p>
      <ul v-else class="webhook-list" data-testid="webhook-list">
        <li v-for="hook in webhooks" :key="hook.webhookId" class="webhook-row" :data-webhook="hook.webhookId">
          <div class="webhook-avatar">
            <WebhookIcon class="w-4 h-4" />
          </div>

          <form v-if="editingId === hook.webhookId" class="flex flex-1 gap-2 min-w-0" @submit.prevent="saveRename(hook.webhookId)">
            <Input v-model="editName" :maxlength="MAX_WEBHOOK_NAME_LENGTH" class="h-8" data-testid="webhook-rename-input" />
            <Button type="submit" size="sm" :disabled="busy || !editName.trim()" data-testid="webhook-rename-save">
              {{ t("save") }}
            </Button>
            <Button type="button" size="sm" variant="outline" @click="editingId = null">{{ t("cancel") }}</Button>
          </form>

          <template v-else>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate" data-testid="webhook-row-name">{{ hook.name }}</p>
              <p class="text-xs text-muted-foreground truncate">
                {{ t("webhook_created_at", { date: formatDate(hook.createdAt) }) }} ·
                {{ hook.lastUsedAt ? t("webhook_last_used", { date: formatDate(hook.lastUsedAt) }) : t("webhook_never_used") }}
              </p>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <Button size="icon" variant="ghost" :title="t('webhook_rename')" data-testid="webhook-rename" @click="startRename(hook)">
                <PencilIcon class="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                :title="t('webhook_regenerate')"
                data-testid="webhook-regenerate"
                @click="pending = { kind: 'regenerate', hook }">
                <RefreshCwIcon class="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                class="hover:text-destructive"
                :title="t('webhook_delete')"
                data-testid="webhook-delete"
                @click="pending = { kind: 'delete', hook }">
                <Trash2Icon class="w-4 h-4" />
              </Button>
            </div>
          </template>
        </li>
      </ul>
    </div>

    <Dialog :open="!!pending" @update:open="(open: boolean) => { if (!open) pending = null; }">
      <DialogContent described class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {{ pending?.kind === "delete" ? t("webhook_delete_confirm_title") : t("webhook_regenerate_confirm_title") }}
          </DialogTitle>
          <DialogDescription>
            {{ pending?.kind === "delete" ? t("webhook_delete_confirm") : t("webhook_regenerate_confirm") }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="pending = null">{{ t("cancel") }}</Button>
          <Button
            :variant="pending?.kind === 'delete' ? 'destructive' : 'default'"
            :disabled="busy"
            data-testid="webhook-confirm"
            @click="confirmPending">
            {{ pending?.kind === "delete" ? t("delete") : t("webhook_regenerate") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * The "Integrations" tab of the channel settings, for text and announcement channels: the
 * channel's incoming webhooks. The URL of a new webhook (or of one given a new token) is shown once,
 * with a copy button; after that only its name and when it was last used are known.
 */
import { onMounted, ref, toRef } from "vue";
import { Input } from "@argon/ui/input";
import { Button } from "@argon/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import {
  CopyIcon, Loader2, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon, TriangleAlertIcon, WebhookIcon,
} from "lucide-vue-next";
import type { ArgonChannel, ChannelWebhook } from "@argon/glue";
import { useLocale } from "@/store/system/localeStore";
import {
  MAX_WEBHOOKS_PER_CHANNEL,
  MAX_WEBHOOK_NAME_LENGTH,
  useChannelWebhooks,
  type WebhookOutcome,
} from "@/composables/useChannelWebhooks";

const props = defineProps<{ channel: ArgonChannel }>();

const { t } = useLocale();
const { toast } = useToast();

const { webhooks, loading, busy, revealed, atLimit, load, create, rename, regenerate, remove, dismissReveal } =
  useChannelWebhooks(toRef(props, "channel"));

const newName = ref("");
const editingId = ref<string | null>(null);
const editName = ref("");
const pending = ref<{ kind: "delete" | "regenerate"; hook: ChannelWebhook } | null>(null);

onMounted(async () => {
  if (!(await load())) toast({ title: t("webhook_load_failed"), variant: "destructive" });
});

function report(outcome: WebhookOutcome, success?: string) {
  if (outcome.ok) {
    if (success) toast({ title: t(success) });
  } else {
    toast({ title: t(outcome.errorKey, { max: MAX_WEBHOOK_NAME_LENGTH }), variant: "destructive" });
  }
}

async function onCreate() {
  const outcome = await create(newName.value);
  if (outcome.ok) newName.value = "";
  report(outcome);
}

function startRename(hook: ChannelWebhook) {
  editingId.value = hook.webhookId;
  editName.value = hook.name;
}

async function saveRename(webhookId: string) {
  const outcome = await rename(webhookId, editName.value);
  if (outcome.ok) editingId.value = null;
  report(outcome, "webhook_saved");
}

async function confirmPending() {
  const action = pending.value;
  if (!action) return;
  const outcome = action.kind === "delete" ? await remove(action.hook.webhookId) : await regenerate(action.hook.webhookId);
  pending.value = null;
  report(outcome, action.kind === "delete" ? "webhook_deleted" : undefined);
}

async function copyUrl() {
  if (!revealed.value) return;
  try {
    await navigator.clipboard.writeText(revealed.value.url);
    toast({ title: t("webhook_url_copied") });
  } catch (e) {
    logger.warn("[Webhooks] copy failed", e);
  }
}

const formatDate = (at: { toDate(): Date }) => at.toDate().toLocaleDateString();
</script>

<style scoped>
.setting-card {
  border-radius: 0.75rem;
  border: 1px solid hsl(var(--border) / 0.5);
  background-color: hsl(var(--card) / var(--card-alpha));
  padding: 1.5rem;
  overflow: hidden;
}

.webhook-reveal {
  border-radius: 0.5rem;
  border: 1px solid hsl(var(--primary) / 0.35);
  background: hsl(var(--primary) / 0.06);
  padding: 0.875rem 1rem;
}

.webhook-list {
  display: flex;
  flex-direction: column;
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 0.5rem;
  overflow: hidden;
}

.webhook-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
}

.webhook-row + .webhook-row {
  border-top: 1px solid hsl(var(--border) / 0.5);
}

.webhook-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  flex-shrink: 0;
  border-radius: 9999px;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.14);
}
</style>
