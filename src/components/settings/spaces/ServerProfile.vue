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
                    <SpaceBadges
                      :is-official="currentSpace.isOfficial"
                      :is-verified="currentSpace.isVerified"
                      :is-community="currentSpace.isCommunity"
                      :size="16" />
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
          <button class="id-field icon-motion icon-motion--pop" @click="copyServerId" :title="t('copy')">
            <code class="id-value">{{ currentSpace.spaceId }}</code>
            <CopyIcon class="w-4 h-4 shrink-0 text-muted-foreground" />
          </button>
        </div>
      </div>

      <!-- Danger Zone (cyberpunk) -->
      <DangerZone v-if="canManageServer" :title="t('delete_server')" :description="t('delete_server_desc')">
        <!-- Once scheduled the button would be a second countdown to nowhere: what the owner
             needs from here on is the date and a way out of it. -->
        <template v-if="isDeletionScheduled">
          <p class="danger-action-desc">
            {{ t("server_deletion_scheduled_desc", {
              date: deletionState?.executionAt?.toDate().toLocaleString() ?? "",
            }) }}
          </p>
          <button class="danger-btn" :disabled="isDeletingServer" @click="cancelServerDeletion">
            <span>{{ t("cancel_server_deletion") }}</span>
          </button>
        </template>

        <button v-else class="danger-btn" @click="showDeleteServerDialog = true">
          <TrashIcon class="w-4 h-4" />
          <span>{{ t("delete_server") }}</span>
        </button>
      </DangerZone>
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
  Loader2,
} from "lucide-vue-next";
import SpaceBadges from "@/components/shared/SpaceBadges.vue";
import type { IonDateTime } from "@argon-chat/ion.webcore";
import { SpaceDeletionStatus, type SpaceStats } from "@argon/glue";
import ServerAvatarUploader from "./ServerAvatarUploader.vue";
import ServerHeaderUploader from "./ServerHeaderUploader.vue";
import DangerZone from "@/components/shared/DangerZone.vue";
import { usePoolStore } from "@/store/data/poolStore";
import { useSpaceStore } from "@/store/data/serverStore";
import { usePexStore } from "@/store/data/permissionStore";
import { useLocale } from "@/store/system/localeStore";
import { useApi } from "@/store/system/apiStore";
import { useToast } from "@argon/ui/toast";
import { useLiveQuery } from "@/composables/useLiveQuery";
import { db } from "@/store/db/dexie";

const { t } = useLocale();
const pool = usePoolStore();
const spaces = useSpaceStore();
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

const formatDate = (date: IonDateTime) => {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date.toDate());
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
    const result = await api.serverInteraction.RequestDeleteSpace(currentSpace.value.spaceId);

    if (result.isSuccessRequestDeleteSpace()) {
      spaces.setDeletionState(currentSpace.value.spaceId, result.state);
      // Deliberately not "deleted": the space is still here, and saying otherwise would send the
      // owner away thinking it was gone while every member still sees it.
      toast({
        title: t("server_deletion_scheduled"),
        description: t("server_deletion_scheduled_desc", {
          date: result.state.executionAt?.toDate().toLocaleString() ?? "",
        }),
      });
      showDeleteServerDialog.value = false;
    } else {
      toast({ title: t("error"), description: t("failed_to_delete_server"), variant: "destructive" });
    }
  } catch {
    toast({ title: t("error"), description: t("failed_to_delete_server"), variant: "destructive" });
  } finally {
    isDeletingServer.value = false;
  }
}

// Read from the store rather than a local ref: SpaceDeletionScheduled/Cancelled arrive on the bus
// and have to move this screen too, including when somebody else's client started the clock.
const deletionState = computed(() =>
  currentSpace.value ? spaces.deletionStateOf(currentSpace.value.spaceId) : null,
);

const isDeletionScheduled = computed(
  () => deletionState.value?.status === SpaceDeletionStatus.SCHEDULED,
);

async function cancelServerDeletion() {
  if (!currentSpace.value) return;
  isDeletingServer.value = true;
  try {
    const result = await api.serverInteraction.CancelDeleteSpace(currentSpace.value.spaceId);

    if (result.isSuccessCancelDeleteSpace()) {
      spaces.setDeletionState(currentSpace.value.spaceId, null);
      toast({
        title: t("server_deletion_cancelled"),
        description: t("server_deletion_cancelled_desc"),
      });
    } else {
      toast({ title: t("error"), variant: "destructive" });
    }
  } finally {
    isDeletingServer.value = false;
  }
}

async function loadDeletionState() {
  if (!currentSpace.value) return;
  const state = await api.serverInteraction.GetSpaceDeletionState(currentSpace.value.spaceId);
  spaces.setDeletionState(currentSpace.value.spaceId, state);
}

onMounted(async () => {
  await loadStats();
  await loadDeletionState();
});
</script>

<style scoped>
.server-profile-container {
  max-width: 900px;
  margin: 0 auto;
}

.setting-card {
  border-radius: 0.75rem;
  border: 1px solid hsl(var(--border) / 0.5);
  background-color: hsl(var(--card) / var(--card-alpha));
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
/* The danger zone itself (tape, glitch title, button) lives in shared/DangerZone.vue. */

/* Light theme: the same warning drawn on paper instead of neon on black. A black slab in the
   middle of a white settings page read as a rendering fault rather than as a hazard. */
:root:not(.dark) .danger-zone-wrap {
  filter: drop-shadow(0 6px 16px hsl(350 80% 55% / 0.18));
}

:root:not(.dark) .danger-zone {
  background: linear-gradient(180deg, hsl(350 100% 99%), hsl(350 80% 96%));
  border-color: hsl(350 75% 62% / 0.55);
}

:root:not(.dark) .danger-hazard {
  background: repeating-linear-gradient(-45deg, #e11d48 0, #e11d48 10px, #ffd7e0 10px, #ffd7e0 20px);
  opacity: 1;
}

:root:not(.dark) .danger-scanlines {
  background: repeating-linear-gradient(
    0deg,
    hsl(350 60% 40% / 0.05) 0,
    hsl(350 60% 40% / 0.05) 1px,
    transparent 1px,
    transparent 3px
  );
}

:root:not(.dark) .danger-icon {
  color: #be123c;
  filter: none;
}

:root:not(.dark) .danger-title {
  color: #be123c;
  text-shadow: none;
}

:root:not(.dark) .danger-title::before {
  color: #0e7490;
}

:root:not(.dark) .danger-title::after {
  color: #e11d48;
}

:root:not(.dark) .danger-action-title {
  color: hsl(350 30% 16%);
}

:root:not(.dark) .danger-action-desc {
  color: hsl(350 12% 38%);
}

:root:not(.dark) .danger-btn {
  color: #be123c;
  background: hsl(350 90% 60% / 0.08);
  border-color: hsl(350 75% 58% / 0.5);
  box-shadow: none;
}

:root:not(.dark) .danger-btn:not(:disabled):hover {
  background: #e11d48;
  border-color: #e11d48;
  color: #fff;
  box-shadow: 0 4px 14px hsl(350 80% 55% / 0.35);
}

:root:not(.dark) .danger-btn:disabled {
  color: hsl(350 12% 55%);
  border-color: hsl(350 12% 70%);
  background: hsl(350 20% 92% / 0.6);
}

:root:not(.dark) .danger-lock {
  color: hsl(350 12% 48%);
}

@media (prefers-reduced-motion: reduce) {
  .danger-hazard { animation: none; }
  .danger-title::before,
  .danger-title::after { animation: none; opacity: 0; }
}
</style>
