<template>
  <div class="space-y-6" data-testid="connections-settings">
    <div class="setting-card">
      <div class="flex items-center justify-between gap-2 mb-2">
        <div class="flex items-center gap-2">
          <LinkIcon class="w-5 h-5 text-primary" />
          <h3 class="text-lg font-semibold">{{ t("connections") }}</h3>
        </div>
        <Button @click="store.load()" variant="ghost" size="icon" class="h-8 w-8" :disabled="store.loading"
          :title="t('connections_reload')">
          <RefreshCwIcon class="w-4 h-4" :class="{ 'animate-spin': store.loading }" />
        </Button>
      </div>
      <p class="text-xs text-muted-foreground mb-4">{{ t("connections_description") }}</p>

      <div v-if="store.available.length > 0" class="provider-grid">
        <button v-for="info in store.available" :key="info.provider" type="button" class="provider-tile"
          :class="{ 'provider-tile--pending': store.pending === info.provider }"
          :disabled="busyProvider !== null || store.pending !== null"
          :data-testid="`connect-${meta(info.provider)?.slug}`"
          :title="t('connections_connect_to', { provider: meta(info.provider)?.name })"
          @click="connect(info.provider)">
          <component :is="meta(info.provider)?.icon" class="w-7 h-7" :style="{ color: meta(info.provider)?.color }" />
          <span class="text-xs font-medium">{{ meta(info.provider)?.name }}</span>
          <Loader2 v-if="busyProvider === info.provider" class="provider-tile-spinner w-4 h-4 animate-spin" />
        </button>
      </div>
      <div v-else-if="store.loaded && store.mine.length === 0" class="text-sm text-muted-foreground py-2">
        {{ t("connections_none_available") }}
      </div>

      <!-- The sign-in runs in the system browser; the list updates by itself when it comes back. -->
      <div v-if="store.pending !== null" class="pending-row" data-testid="connections-pending">
        <Loader2 class="w-4 h-4 animate-spin shrink-0" />
        <span class="flex-1 text-sm">
          {{ t("connections_finish_in_browser", { provider: meta(store.pending)?.name }) }}
        </span>
        <Button variant="ghost" size="sm" @click="store.cancelPending()">{{ t("cancel") }}</Button>
      </div>
    </div>

    <div v-if="store.mine.length > 0" class="setting-card space-y-3">
      <div v-for="connection in store.mine" :key="connection.provider" class="connection-row"
        :data-testid="`connection-${meta(connection.provider)?.slug}`">
        <div class="flex items-start gap-3">
          <div class="connection-icon" :style="{ color: meta(connection.provider)?.color }">
            <component :is="meta(connection.provider)?.icon" class="w-6 h-6" />
          </div>

          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex items-center gap-2 min-w-0">
              <button v-if="connection.url" type="button" class="connection-name truncate" @click="openExternalUrl(connection.url)">
                {{ connection.name }}
              </button>
              <span v-else class="connection-name truncate">{{ connection.name }}</span>
              <BadgeCheckIcon v-if="connection.verified" class="w-4 h-4 text-primary shrink-0" :title="t('connections_verified')" />
              <Badge v-if="connection.status === ConnectionStatus.NEEDS_REAUTH" variant="outline"
                class="bg-amber-500/10 text-amber-500 border-amber-500/30 shrink-0">
                {{ t("connections_needs_reauth") }}
              </Badge>
              <Badge v-else-if="connection.status === ConnectionStatus.SUSPENDED" variant="outline"
                class="bg-red-500/10 text-red-500 border-red-500/30 shrink-0" :title="t('connections_error_suspended')">
                {{ t("connections_suspended") }}
              </Badge>
            </div>
            <div class="text-xs text-muted-foreground">{{ meta(connection.provider)?.name }}</div>
            <div v-if="visibleDetails(connection.details).length > 0" class="flex flex-wrap gap-1.5 pt-1">
              <span v-for="detail in visibleDetails(connection.details)" :key="detail.key" class="detail-chip">
                <template v-if="detail.kind === ConnectionDetailKind.FLAG">{{ t(`connection_detail_${detailSlug(detail.key)}`) }}</template>
                <template v-else>{{ t(`connection_detail_${detailSlug(detail.key)}`) }}: {{ formatDetailValue(detail, localeStore.currentLocale) }}</template>
              </span>
            </div>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <Button v-if="connection.status === ConnectionStatus.NEEDS_REAUTH" size="sm" variant="secondary"
              :disabled="store.pending !== null" @click="connect(connection.provider)">
              {{ t("connections_reconnect") }}
            </Button>
            <Button v-else-if="connection.status === ConnectionStatus.ACTIVE && has(connection.provider, ConnectionCapability.DETAILS)" variant="ghost" size="icon"
              class="h-8 w-8" :disabled="busyProvider !== null" :title="t('connections_refresh')"
              @click="refresh(connection.provider)">
              <RefreshCwIcon class="w-4 h-4" :class="{ 'animate-spin': busyProvider === connection.provider }" />
            </Button>
            <Button variant="ghost" size="icon" class="h-8 w-8 text-red-500 hover:text-red-400"
              :title="t('connections_disconnect')" @click="disconnecting = connection.provider">
              <UnlinkIcon class="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div class="option-grid">
          <label class="option-row">
            <span>{{ t("connections_display_on_profile") }}</span>
            <Switch :model-value="connection.options.displayOnProfile"
              @update:model-value="(v: boolean) => setOption(connection.provider, 'displayOnProfile', v)" />
          </label>
          <label v-if="has(connection.provider, ConnectionCapability.DETAILS)" class="option-row">
            <span>{{ t("connections_show_details") }}</span>
            <Switch :model-value="connection.options.showDetails" :disabled="!connection.options.displayOnProfile"
              @update:model-value="(v: boolean) => setOption(connection.provider, 'showDetails', v)" />
          </label>
          <label v-if="has(connection.provider, ConnectionCapability.STATUS)" class="option-row">
            <span>{{ t("connections_display_as_status", { provider: meta(connection.provider)?.name }) }}</span>
            <Switch :model-value="connection.options.displayAsStatus"
              @update:model-value="(v: boolean) => setOption(connection.provider, 'displayAsStatus', v)" />
          </label>
          <label v-if="has(connection.provider, ConnectionCapability.LISTEN_ALONG)" class="option-row">
            <span>{{ t("connections_allow_listen_along") }}</span>
            <Switch :model-value="connection.options.allowListenAlong"
              @update:model-value="(v: boolean) => setOption(connection.provider, 'allowListenAlong', v)" />
          </label>
        </div>
      </div>
    </div>

    <div v-if="store.mine.length > 0" class="setting-card">
      <div class="flex flex-row items-center justify-between gap-4">
        <div class="space-y-0.5">
          <div class="text-base">{{ t("connections_visibility") }}</div>
          <div class="text-sm text-muted-foreground">{{ t("connections_visibility_desc") }}</div>
        </div>
        <select v-model.number="visibility" class="bg-transparent border rounded-md px-3 py-1.5 text-sm"
          :disabled="visibilityBusy" data-testid="connections-visibility" @change="saveVisibility">
          <option :value="PrivacyRuleMode.EVERYBODY">{{ t("connections_visibility_everybody") }}</option>
          <option :value="PrivacyRuleMode.CONTACTS">{{ t("connections_visibility_contacts") }}</option>
          <option :value="PrivacyRuleMode.NOBODY">{{ t("connections_visibility_nobody") }}</option>
        </select>
      </div>
    </div>

    <Dialog :open="disconnecting !== null" @update:open="(open: boolean) => { if (!open) disconnecting = null; }">
      <DialogContent class="max-w-[480px]" @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle>{{ t("connections_disconnect_confirm", { provider: meta(disconnecting!)?.name }) }}</DialogTitle>
        </DialogHeader>
        <div class="text-sm text-muted-foreground">{{ t("connections_disconnect_confirm_desc") }}</div>
        <DialogFooter>
          <Button variant="outline" @click="disconnecting = null">{{ t("cancel") }}</Button>
          <Button variant="destructive" :disabled="busyProvider !== null" @click="disconnect">
            {{ t("connections_disconnect") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="replacing !== null" @update:open="(open: boolean) => { if (!open) replacing = null; }">
      <DialogContent class="max-w-[480px]" @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle>{{ t("connections_replace_title", { provider: meta(replacing!)?.name }) }}</DialogTitle>
        </DialogHeader>
        <div class="text-sm text-muted-foreground">{{ t("connections_replace_desc") }}</div>
        <DialogFooter>
          <Button variant="outline" @click="replacing = null">{{ t("cancel") }}</Button>
          <Button @click="replace">{{ t("connections_replace_action") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import {
  BeginConnectError,
  ConnectionCapability,
  ConnectionDetailKind,
  ConnectionError,
  ConnectionStatus,
  PrivacyRuleMode,
  type ConnectionOptions,
  type ConnectionProvider,
} from "@argon/glue";
import { Badge } from "@argon/ui/badge";
import { Button } from "@argon/ui/button";
import { Switch } from "@argon/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { BadgeCheckIcon, LinkIcon, Loader2, RefreshCwIcon, UnlinkIcon } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";
import { useApi } from "@/store/system/apiStore";
import {
  BEGIN_CONNECT_ERROR_KEYS,
  CONNECTION_ERROR_KEYS,
  useConnectionsStore,
} from "@/store/features/connectionsStore";
import {
  detailSlug,
  formatDetailValue,
  hasCapability,
  providerMeta,
  visibleDetails,
} from "@/lib/connections/providers";
import { openExternalUrl } from "@/lib/linkPreview/openExternal";

const VISIBILITY_KEY = "connections.visibility";

const localeStore = useLocale();
const { t } = localeStore;
const { toast } = useToast();
const api = useApi();
const store = useConnectionsStore();

const busyProvider = ref<ConnectionProvider | null>(null);
const disconnecting = ref<ConnectionProvider | null>(null);
const replacing = ref<ConnectionProvider | null>(null);
const visibility = ref<PrivacyRuleMode>(PrivacyRuleMode.EVERYBODY);
const visibilityBusy = ref(false);

const meta = providerMeta;
const has = (provider: ConnectionProvider, flag: ConnectionCapability) => hasCapability(store.capabilitiesOf(provider), flag);

// A sign-in that finished while this window was in the background is picked up on return, in
// case its event was lost to a reconnect.
function onFocus() {
  if (store.pending !== null) void store.load();
}

onMounted(async () => {
  window.addEventListener("focus", onFocus);
  await store.load();
  await loadVisibility();
});

onUnmounted(() => window.removeEventListener("focus", onFocus));

async function connect(provider: ConnectionProvider, replace = false) {
  busyProvider.value = provider;
  try {
    const error = await store.connect(provider, replace);
    if (error === BeginConnectError.PROVIDER_ALREADY_LINKED) replacing.value = provider;
    else if (error !== BeginConnectError.NONE) fail(BEGIN_CONNECT_ERROR_KEYS[error]);
  } catch (e) {
    logger.error("[connections] connect failed", e);
    fail("connections_error_unknown");
  } finally {
    busyProvider.value = null;
  }
}

async function replace() {
  const provider = replacing.value;
  replacing.value = null;
  if (provider !== null) await connect(provider, true);
}

async function disconnect() {
  const provider = disconnecting.value;
  if (provider === null) return;
  busyProvider.value = provider;
  try {
    if (await store.disconnect(provider)) toast({ title: t("connections_disconnected", { provider: meta(provider)?.name }) });
  } catch (e) {
    logger.error("[connections] disconnect failed", e);
    fail("connections_error_unknown");
  } finally {
    busyProvider.value = null;
    disconnecting.value = null;
  }
}

async function refresh(provider: ConnectionProvider) {
  busyProvider.value = provider;
  try {
    const error = await store.refresh(provider);
    if (error !== ConnectionError.NONE) fail(CONNECTION_ERROR_KEYS[error]);
  } catch (e) {
    logger.error("[connections] refresh failed", e);
    fail("connections_error_unknown");
  } finally {
    busyProvider.value = null;
  }
}

async function setOption(provider: ConnectionProvider, option: keyof ConnectionOptions, value: boolean) {
  try {
    const error = await store.updateOptions(provider, { [option]: value });
    if (error !== ConnectionError.NONE) fail(CONNECTION_ERROR_KEYS[error]);
  } catch (e) {
    logger.error("[connections] option update failed", e);
    fail("connections_error_unknown");
  }
}

async function loadVisibility() {
  try {
    const rule = await api.privacyInteraction.GetPrivacyRule(VISIBILITY_KEY, null);
    if (rule) visibility.value = rule.mode;
  } catch (e) {
    logger.warn("[connections] failed to load the visibility rule", e);
  }
}

async function saveVisibility() {
  visibilityBusy.value = true;
  try {
    await api.privacyInteraction.SetPrivacyRule(VISIBILITY_KEY, visibility.value, null, [], []);
  } catch (e) {
    logger.warn("[connections] failed to save the visibility rule", e);
    fail("connections_error_unknown");
  } finally {
    visibilityBusy.value = false;
  }
}

function fail(key: string) {
  toast({ title: t("error"), description: t(key), variant: "destructive" });
}
</script>

<style scoped>
.setting-card {
  border-radius: 0.5rem;
  border: 1px solid hsl(var(--border) / 0.5);
  background-color: hsl(var(--card) / var(--card-alpha));
  padding: 1.5rem;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
  gap: 0.5rem;
}

.provider-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 0.5rem;
  border-radius: 0.625rem;
  border: 1px solid hsl(var(--border) / 0.6);
  background: hsl(var(--muted) / 0.25);
  transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.provider-tile:hover:not(:disabled) {
  background: hsl(var(--muted) / 0.5);
  border-color: hsl(var(--primary) / 0.5);
  transform: translateY(-1px);
}

.provider-tile:disabled {
  opacity: 0.55;
  cursor: default;
}

.provider-tile--pending {
  border-color: hsl(var(--primary));
  opacity: 1 !important;
}

.provider-tile-spinner {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
}

.pending-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: hsl(var(--primary) / 0.1);
}

.connection-row {
  padding: 0.875rem 1rem;
  border-radius: 0.625rem;
  border: 1px solid hsl(var(--border) / 0.6);
  background: hsl(var(--muted) / 0.25);
}

.connection-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  background: hsl(var(--background) / 0.6);
  flex-shrink: 0;
}

.connection-name {
  font-weight: 600;
  font-size: 0.9375rem;
  text-align: left;
}

button.connection-name:hover {
  text-decoration: underline;
}

.detail-chip {
  font-size: 0.6875rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  background: hsl(var(--background) / 0.6);
  color: hsl(var(--muted-foreground));
}

.option-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: 0.25rem 1.5rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid hsl(var(--border) / 0.4);
}

.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.8125rem;
  padding: 0.25rem 0;
  cursor: pointer;
}
</style>
