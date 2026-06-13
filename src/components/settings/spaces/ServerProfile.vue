<template>
  <div class="server-profile-container">
    <div v-if="!currentSpace" class="flex items-center justify-center min-h-[400px]">
      <p class="text-muted-foreground">{{ t("loading_server_information") }}</p>
    </div>

    <div v-else class="space-y-6">
      <!-- Identity card: header, avatar, name, description -->
      <div class="setting-card">
        <ServerHeaderUploader
          :header-file-id="currentSpace.topBannerFileId"
          :space-id="currentSpace.spaceId"
          @header-updated="onServerHeaderUpdated"
        />

        <div class="flex items-start gap-6 -mt-10 px-1">
          <ServerAvatarUploader
            :fallback="(currentSpace.name || '?').substring(0, 2).toUpperCase()"
            :avatar-file-id="currentSpace.avatarFieldId"
            :space-id="currentSpace.spaceId"
            @avatar-updated="onServerAvatarUpdated"
          />

          <div class="flex-1 space-y-4 pt-12">
            <div class="flex items-center gap-2">
              <h2 class="text-xl font-bold truncate">{{ currentSpace.name }}</h2>
              <PhSealCheck v-if="currentSpace.isOfficial" weight="fill" class="w-5 h-5 text-sky-400" title="Official" />
              <PhSealCheck v-else-if="currentSpace.isVerified" weight="fill" class="w-5 h-5 text-yellow-400" title="Verified" />
            </div>

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

      <!-- Danger Zone -->
      <div v-if="canManageServer" class="setting-card border-red-500/20">
        <div class="flex items-center gap-2 mb-4">
          <AlertTriangleIcon class="w-5 h-5 text-red-500" />
          <h3 class="text-lg font-semibold text-red-500">{{ t("danger_zone") }}</h3>
        </div>

        <div class="space-y-2">
          <h4 class="font-medium">{{ t("delete_server") }}</h4>
          <p class="text-sm text-muted-foreground">{{ t("delete_server_desc") }}</p>
          <Button @click="showDeleteServerDialog = true" variant="destructive" size="sm">
            <TrashIcon class="w-4 h-4 mr-2" />
            {{ t("delete_server") }}
          </Button>
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
</style>
