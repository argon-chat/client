<template>
  <div class="server-profile-container">
    <div v-if="!currentSpace" class="flex items-center justify-center min-h-[400px]">
      <p class="text-muted-foreground">{{ t("loading_server_information") }}</p>
    </div>

    <div v-else class="space-y-6">
      <!-- Identity card: compact preview (left) + controls (right) -->
      <div class="setting-card">
        <div class="flex flex-col lg:flex-row gap-8">
          <!-- Compact preview — mirrors the user-profile card; the banner uses the
               sidebar's 9:4 ratio so it shows the exact same crop, at a sane size. -->
          <div class="flex-shrink-0 w-full lg:w-[320px] space-y-3">
            <div class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{{ t("preview") }}</div>
            <div class="space-preview">
              <ServerHeaderUploader
                :header-file-id="currentSpace.topBannerFileId"
                :space-id="currentSpace.spaceId"
                @header-updated="onServerHeaderUpdated"
              />
              <div class="flex items-end gap-3 -mt-8 px-3 pb-3 relative z-10">
                <div class="space-preview-avatar">
                  <ServerAvatarUploader
                    :fallback="(currentSpace.name || '?').substring(0, 2).toUpperCase()"
                    :avatar-file-id="currentSpace.avatarFieldId"
                    :space-id="currentSpace.spaceId"
                    @avatar-updated="onServerAvatarUpdated"
                  />
                </div>
                <div class="min-w-0 pb-1">
                  <div class="flex items-center gap-1.5">
                    <span class="font-bold truncate">{{ currentSpace.name }}</span>
                    <PhSealCheck v-if="currentSpace.isOfficial" weight="fill" class="w-4 h-4 text-sky-400 shrink-0" title="Official" />
                    <PhSealCheck v-else-if="currentSpace.isVerified" weight="fill" class="w-4 h-4 text-yellow-400 shrink-0" title="Verified" />
                  </div>
                  <div class="text-xs text-muted-foreground">
                    {{ stats ? stats.memberCount : "—" }} {{ t("members") }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Controls -->
          <div class="flex-1 min-w-0 space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">{{ t("server_name") }}</label>
              <div class="flex items-center gap-2">
                <Input v-model="serverName" :placeholder="t('server_name')" :disabled="!canManageServer" class="flex-1" />
                <Button @click="updateServerInfo" :disabled="!canManageServer || !infoDirty || isUpdating" size="sm">
                  <Loader2 v-if="isUpdating" class="w-4 h-4 mr-2 animate-spin" />
                  {{ t("save") }}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Stats card -->
      <div class="setting-card space-y-4">
        <div class="flex items-center gap-2">
          <BarChart3Icon class="w-5 h-5" />
          <h3 class="text-lg font-semibold">{{ t("server_statistics") }}</h3>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="stat-tile">
            <UsersIcon class="w-4 h-4 text-muted-foreground" />
            <span class="stat-value">{{ stats ? stats.memberCount : "—" }}</span>
            <span class="stat-label">{{ t("members") }}</span>
          </div>
          <div class="stat-tile">
            <span class="online-dot" />
            <span class="stat-value">{{ stats ? stats.onlineCount : "—" }}</span>
            <span class="stat-label">{{ t("online") }}</span>
          </div>
          <div class="stat-tile">
            <HashIcon class="w-4 h-4 text-muted-foreground" />
            <span class="stat-value">{{ stats ? stats.channelCount : "—" }}</span>
            <span class="stat-label">{{ t("channels") }}</span>
          </div>
          <div class="stat-tile">
            <RocketIcon class="w-4 h-4 text-violet-400" />
            <span class="stat-value">{{ currentSpace.boostCount }} · L{{ currentSpace.boostLevel }}</span>
            <span class="stat-label">{{ t("boosts") }}</span>
          </div>
        </div>

        <div v-if="stats" class="text-xs text-muted-foreground">
          {{ t("created_at") }}: {{ formatDate(stats.createdAt) }}
        </div>
      </div>

      <!-- Appearance card -->
      <div class="setting-card space-y-4">
        <div class="flex items-center gap-2">
          <SlidersHorizontalIcon class="w-5 h-5" />
          <h3 class="text-lg font-semibold">{{ t("appearance") }}</h3>
        </div>

        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="font-medium">{{ t("hide_boost_strip") }}</p>
            <p class="text-sm text-muted-foreground">{{ t("hide_boost_strip_desc") }}</p>
          </div>
          <Switch :checked="hideBoost" :disabled="!canManageServer || isTogglingBoost" @update:checked="onToggleBoostStrip" />
        </div>
      </div>

      <!-- Server info card -->
      <div class="setting-card space-y-4">
        <div class="flex items-center gap-2">
          <InfoIcon class="w-5 h-5" />
          <h3 class="text-lg font-semibold">{{ t("server_information") }}</h3>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium text-muted-foreground">{{ t("server_id") }}</label>
          <button class="id-field" @click="copyServerId" :title="t('copy')">
            <code class="id-value">{{ currentSpace.spaceId }}</code>
            <CopyIcon class="w-4 h-4 shrink-0 text-muted-foreground" />
          </button>
        </div>
      </div>

      <!-- Danger Zone (cyberpunk) -->
      <div v-if="canManageServer" class="danger-zone-wrap">
        <div class="danger-zone">
          <div class="danger-hazard"></div>
          <div class="danger-scanlines"></div>
          <div class="danger-content">
            <div class="danger-header">
              <AlertTriangleIcon class="w-5 h-5 danger-icon" />
              <h3 class="danger-title" :data-text="t('danger_zone')">{{ t("danger_zone") }}</h3>
            </div>

            <h4 class="danger-action-title">{{ t("delete_server") }}</h4>
            <p class="danger-action-desc">{{ t("delete_server_desc") }}</p>

            <button class="danger-btn" disabled @click="showDeleteServerDialog = true">
              <TrashIcon class="w-4 h-4" />
              <span>{{ t("delete_server") }}</span>
            </button>
            <p class="danger-lock">
              <LockIcon class="w-3.5 h-3.5" />
              {{ t("temporarily_unavailable") }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete confirmation -->
    <Dialog v-model:open="showDeleteServerDialog">
      <DialogContent @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2 text-red-500">
            <AlertTriangleIcon class="w-5 h-5" />
            {{ t("delete_server") }}
          </DialogTitle>
        </DialogHeader>

        <div class="space-y-4">
          <p class="text-sm">{{ t("delete_server_confirmation", { serverName: currentSpace?.name }) }}</p>
          <p class="text-sm text-muted-foreground">{{ t("delete_server_warning") }}</p>
          <div class="space-y-2">
            <label class="text-sm font-medium">{{ t("type_server_name_to_confirm") }}</label>
            <Input v-model="deleteConfirmationName" :placeholder="currentSpace?.name" class="font-mono" />
          </div>
        </div>

        <DialogFooter>
          <Button @click="showDeleteServerDialog = false" variant="outline">{{ t("cancel") }}</Button>
          <Button
            @click="confirmDeleteServer"
            variant="destructive"
            :disabled="deleteConfirmationName !== currentSpace?.name || isDeletingServer"
          >
            {{ t("delete_server") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { Input } from "@argon/ui/input";
import { Button } from "@argon/ui/button";
import { Switch } from "@argon/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import {
  CopyIcon,
  AlertTriangleIcon,
  TrashIcon,
  UsersIcon,
  HashIcon,
  InfoIcon,
  BarChart3Icon,
  SlidersHorizontalIcon,
  RocketIcon,
  LockIcon,
  Loader2,
} from "lucide-vue-next";
import { PhSealCheck } from "@phosphor-icons/vue";
import type { DateTimeOffset } from "@argon-chat/ion.webcore";
import type { SpaceStats } from "@argon/glue";
import ServerAvatarUploader from "./ServerAvatarUploader.vue";
import ServerHeaderUploader from "./ServerHeaderUploader.vue";
import { usePoolStore } from "@/store/data/poolStore";
import { usePexStore } from "@/store/data/permissionStore";
import { useLocale } from "@/store/system/localeStore";
import { useApi } from "@/store/system/apiStore";
import { useToast } from "@argon/ui/toast";
import { useLiveQuery } from "@/composables/useLiveQuery";
import { db } from "@/store/db/dexie";

const { t } = useLocale();
const pool = usePoolStore();
const pex = usePexStore();
const api = useApi();
const { toast } = useToast();

const spaceId = computed(() => pool.selectedServer);
const currentSpace = useLiveQuery(() => db.servers.where("spaceId").equals(spaceId.value ?? "").first());

const canManageServer = computed(() => pex.has("ManageServer"));

const serverName = ref("");
const isUpdating = ref(false);
const nameInitialized = ref(false);

const stats = ref<SpaceStats | null>(null);

const hideBoost = ref(false);
const isTogglingBoost = ref(false);

const showDeleteServerDialog = ref(false);
const deleteConfirmationName = ref("");
const isDeletingServer = ref(false);

const infoDirty = computed(
  () => !!currentSpace.value && serverName.value.trim() !== currentSpace.value.name,
);

// Populate the editable name once, when the space first loads — later live updates
// (e.g. SpaceDetailsUpdated) must not clobber what the user is typing. Keep the boost
// toggle mirrored from the record.
watch(
  currentSpace,
  (s) => {
    if (!s) return;
    if (!nameInitialized.value) {
      serverName.value = s.name;
      nameInitialized.value = true;
    }
    hideBoost.value = !!s.hideBoostStrip;
  },
  { immediate: true },
);

const formatDate = (date: DateTimeOffset) => {
  if (!date?.date) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date.date));
};

const onServerAvatarUpdated = () => pool.loadServerDetails?.();
const onServerHeaderUpdated = () => pool.loadServerDetails?.();

async function loadStats() {
  if (!spaceId.value) return;
  try {
    stats.value = await api.serverInteraction.GetSpaceStats(spaceId.value);
  } catch {
    // non-fatal — stats stay null and render as placeholders
  }
}

async function updateServerInfo() {
  if (!spaceId.value || !serverName.value.trim() || !infoDirty.value) return;
  isUpdating.value = true;
  try {
    await api.serverInteraction.UpdateSpaceInfo(
      spaceId.value,
      serverName.value.trim(),
      currentSpace.value?.description ?? "",
    );
    await pool.loadServerDetails?.();
    toast({ title: t("server_updated"), description: t("server_name_updated") });
  } catch {
    toast({ title: t("error"), description: t("failed_to_update_server"), variant: "destructive" });
  } finally {
    isUpdating.value = false;
  }
}

async function onToggleBoostStrip(value: boolean) {
  if (!spaceId.value) return;
  hideBoost.value = value;
  isTogglingBoost.value = true;
  try {
    await api.serverInteraction.SetBoostStripHidden(spaceId.value, value);
  } catch {
    hideBoost.value = !value;
    toast({ title: t("error"), variant: "destructive" });
  } finally {
    isTogglingBoost.value = false;
  }
}

function copyServerId() {
  if (!spaceId.value) return;
  navigator.clipboard.writeText(spaceId.value);
  toast({ title: t("copied"), description: t("server_id_copied") });
}

async function confirmDeleteServer() {
  if (!currentSpace.value || deleteConfirmationName.value !== currentSpace.value.name) return;
  isDeletingServer.value = true;
  try {
    // TODO: wire DeleteSpace RPC once available on the server.
    toast({ title: t("server_deleted"), description: t("server_deleted_desc") });
    showDeleteServerDialog.value = false;
  } catch {
    toast({ title: t("error"), description: t("failed_to_delete_server"), variant: "destructive" });
  } finally {
    isDeletingServer.value = false;
  }
}

onMounted(loadStats);
</script>

<style scoped>
.server-profile-container {
  max-width: 900px;
  margin: 0 auto;
}

.setting-card {
  border-radius: 0.75rem;
  border: 1px solid hsl(var(--border) / 0.5);
  background-color: hsl(var(--card));
  padding: 1.5rem;
  overflow: hidden;
}

/* Compact space preview card (banner + overlapping avatar + name). */
.space-preview {
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--card));
}

/* Card-coloured ring so the avatar reads as overlapping the banner. */
.space-preview-avatar {
  flex-shrink: 0;
  line-height: 0;
  border-radius: 9999px;
  box-shadow: 0 0 0 4px hsl(var(--card));
}

.id-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  border-radius: 0.5rem;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.4);
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.id-field:hover {
  background: hsl(var(--muted) / 0.7);
  border-color: hsl(var(--border));
}

.id-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  color: hsl(var(--muted-foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.875rem 0.5rem;
  border-radius: 0.625rem;
  background: hsl(var(--muted) / 0.4);
}

.stat-value {
  font-size: 1.1rem;
  font-weight: 700;
}

.stat-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: hsl(var(--muted-foreground));
}

.online-dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 9999px;
  background: #22c55e;
  box-shadow: 0 0 6px #22c55eaa;
}

/* ───────────────── Cyberpunk Danger Zone ───────────────── */
/* Outer wrapper carries the neon glow so it can follow the clipped shape. */
.danger-zone-wrap {
  filter: drop-shadow(0 0 14px hsl(350 90% 50% / 0.3));
}

.danger-zone {
  position: relative;
  overflow: hidden;
  background: linear-gradient(180deg, hsl(350 55% 7% / 0.96), hsl(350 50% 4% / 0.98));
  border: 1px solid hsl(350 90% 55% / 0.45);
  /* Angular, chamfered corners (top-right + bottom-left). */
  clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px));
}

/* Animated hazard tape. */
.danger-hazard {
  height: 6px;
  background: repeating-linear-gradient(-45deg, #ff003c 0, #ff003c 10px, #2a0010 10px, #2a0010 20px);
  opacity: 0.9;
  animation: dz-hazard 1.4s linear infinite;
}

@keyframes dz-hazard {
  to { background-position: 28.28px 0; }
}

/* CRT scanlines. */
.danger-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    hsl(350 90% 60% / 0.05) 0,
    hsl(350 90% 60% / 0.05) 1px,
    transparent 1px,
    transparent 3px
  );
}

.danger-content {
  position: relative;
  padding: 1.1rem 1.5rem 1.4rem;
}

.danger-header {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.9rem;
}

.danger-icon {
  color: #ff2a6d;
  filter: drop-shadow(0 0 5px hsl(350 90% 55% / 0.85));
}

.danger-title {
  position: relative;
  font-family: ui-monospace, "Courier New", monospace;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #ff2a6d;
  text-shadow: 0 0 8px hsl(350 90% 55% / 0.7), 0 0 2px hsl(350 90% 60% / 0.9);
}

/* Glitch: cyan top-half + red bottom-half offsets that flicker occasionally. */
.danger-title::before,
.danger-title::after {
  content: attr(data-text);
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  pointer-events: none;
  opacity: 0;
}

.danger-title::before {
  color: #05d9e8;
  clip-path: inset(0 0 52% 0);
  animation: dz-glitch-a 3s infinite steps(1);
}

.danger-title::after {
  color: #ff003c;
  clip-path: inset(52% 0 0 0);
  animation: dz-glitch-b 2.7s infinite steps(1);
}

@keyframes dz-glitch-a {
  0%, 92%, 100% { transform: translate(0, 0); opacity: 0; }
  93% { transform: translate(-3px, -1px); opacity: 0.85; }
  96% { transform: translate(2px, 1px); opacity: 0.85; }
}

@keyframes dz-glitch-b {
  0%, 90%, 100% { transform: translate(0, 0); opacity: 0; }
  91% { transform: translate(3px, 1px); opacity: 0.85; }
  95% { transform: translate(-2px, -1px); opacity: 0.85; }
}

.danger-action-title {
  font-weight: 700;
  color: hsl(0 0% 90%);
  margin-bottom: 0.25rem;
}

.danger-action-desc {
  font-size: 0.85rem;
  color: hsl(350 18% 68%);
  margin-bottom: 1rem;
  max-width: 52ch;
}

.danger-btn {
  display: flex;
  width: 100%;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.7rem 1.1rem;
  color: #ff2a6d;
  background: hsl(350 80% 50% / 0.1);
  border: 1px solid hsl(350 90% 55% / 0.6);
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: 0 0 10px hsl(350 90% 50% / 0.25), inset 0 0 12px hsl(350 90% 50% / 0.08);
  clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px));
}

.danger-btn:not(:disabled):hover {
  background: hsl(350 85% 50% / 0.22);
  color: #fff;
  box-shadow: 0 0 18px hsl(350 90% 55% / 0.6), inset 0 0 18px hsl(350 90% 50% / 0.2);
}

.danger-btn:disabled {
  cursor: not-allowed;
  color: hsl(350 25% 55%);
  border-color: hsl(350 25% 45% / 0.5);
  background: hsl(350 25% 28% / 0.15);
  box-shadow: none;
}

.danger-lock {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  margin-top: 0.6rem;
  font-family: ui-monospace, monospace;
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: hsl(350 20% 55%);
}

/* Keep it dark and menacing even in light theme. */
:root:not(.dark) .danger-zone {
  background: linear-gradient(180deg, hsl(350 55% 10%), hsl(350 50% 6%));
}

@media (prefers-reduced-motion: reduce) {
  .danger-hazard { animation: none; }
  .danger-title::before,
  .danger-title::after { animation: none; opacity: 0; }
}
</style>
