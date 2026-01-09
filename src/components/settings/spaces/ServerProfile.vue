<template>
  <div class="server-profile-container">
    <div v-if="!currentSpace" class="flex items-center justify-center min-h-[400px]">
      <p class="text-muted-foreground">Loading server information...</p>
    </div>

    <div v-else class="space-y-6">
      <!-- Server Avatar & Name Card -->
      <div class="setting-card">
        <!-- Server Header -->
        <ServerHeaderUploader
          v-if="currentSpace"
          :header-file-id="currentSpace.topBannerFileId"
          :space-id="currentSpace.spaceId"
          @header-updated="onServerHeaderUpdated"
          class="mb-4"
        />
        
        <div class="flex items-center gap-6">
          <ServerAvatarUploader
            :fallback="currentSpace.name.substring(0, 2).toUpperCase()"
            :avatar-file-id="currentSpace.avatarFieldId"
            :space-id="currentSpace.spaceId"
            @avatar-updated="onServerAvatarUpdated"
          />
          <div class="flex-1 space-y-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">{{ t("server_name") }}</label>
              <div class="setting-item">
                <Input
                  v-model="serverName"
                  :placeholder="t('server_name')"
                  class="flex-1"
                  :disabled="!canManageServer"
                />
                <Button
                  @click="updateServerName"
                  :disabled="!canManageServer || serverName === currentSpace.name || isUpdating"
                  size="sm"
                >
                  {{ t("save") }}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Server Information Card -->
      <div class="setting-card space-y-4">
        <div class="flex items-center gap-2 mb-4">
          <UserIcon class="w-5 h-5" />
          <h3 class="text-lg font-semibold">{{ t("server_information") }}</h3>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium text-muted-foreground">{{ t("server_id") }}</label>
          <div class="flex items-center gap-2">
            <Input :value="currentSpace.id" readonly class="font-mono text-sm" />
            <Button @click="copyServerId" size="sm" variant="outline">
              <CopyIcon class="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium text-muted-foreground">{{ t("created_at") }}</label>
          <Input :value="formatDate(currentSpace.createdAt)" readonly />
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium text-muted-foreground">{{ t("owner") }}</label>
          <Input :value="ownerUsername" readonly />
        </div>
      </div>

      <!-- Danger Zone Card -->
      <div v-if="isOwner" class="setting-card border-red-500/20">
        <div class="flex items-center gap-2 mb-4">
          <AlertTriangleIcon class="w-5 h-5 text-red-500" />
          <h3 class="text-lg font-semibold text-red-500">{{ t("danger_zone") }}</h3>
        </div>

        <div class="space-y-4">
          <div class="space-y-2">
            <h4 class="font-medium">{{ t("delete_server") }}</h4>
            <p class="text-sm text-muted-foreground">
              {{ t("delete_server_desc") }}
            </p>
            <Button @click="showDeleteServerDialog = true" variant="destructive" size="sm">
              <TrashIcon class="w-4 h-4 mr-2" />
              {{ t("delete_server") }}
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete Server Confirmation Dialog -->
    <Dialog v-model:open="showDeleteServerDialog">
      <DialogContent @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2 text-red-500">
            <AlertTriangleIcon class="w-5 h-5" />
            {{ t("delete_server") }}
          </DialogTitle>
        </DialogHeader>

        <div class="space-y-4">
          <p class="text-sm">
            {{ t("delete_server_confirmation", { serverName: currentSpace?.name }) }}
          </p>
          <p class="text-sm text-muted-foreground">
            {{ t("delete_server_warning") }}
          </p>
          <div class="space-y-2">
            <label class="text-sm font-medium">
              {{ t("type_server_name_to_confirm") }}
            </label>
            <Input
              v-model="deleteConfirmationName"
              :placeholder="currentSpace?.name"
              class="font-mono"
            />
          </div>
        </div>

        <DialogFooter>
          <Button @click="showDeleteServerDialog = false" variant="outline">
            {{ t("cancel") }}
          </Button>
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
import { ref, computed, onMounted } from "vue";
import { Input } from "@argon/ui/input";
import { Button } from "@argon/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@argon/ui/dialog";
import ServerAvatarUploader from "./ServerAvatarUploader.vue";
import { usePoolStore } from "@/store/poolStore";
import { useMe } from "@/store/meStore";
import { useLocale } from "@/store/localeStore";
import { useApi } from "@/store/apiStore";
import { useToast } from "@argon/ui/toast";
import {
  UserIcon,
  CopyIcon,
  AlertTriangleIcon,
  TrashIcon,
} from "lucide-vue-next";
import ServerHeaderUploader from "./ServerHeaderUploader.vue";

const { t } = useLocale();
const pool = usePoolStore();
const me = useMe();
const api = useApi();
const { toast } = useToast();

const currentSpace = ref<any>(null);
const isOwner = computed(() => currentSpace.value?.ownerId === me.me?.userId);
const canManageServer = computed(() => {
  // TODO: Check for proper permissions
  return isOwner.value;
});

const serverName = ref("");
const isUpdating = ref(false);
const ownerUsername = ref("Loading...");

const showDeleteServerDialog = ref(false);
const deleteConfirmationName = ref("");
const isDeletingServer = ref(false);

const onServerAvatarUpdated = async () => {
  console.log("Server avatar updated successfully");
  // Refresh space data
  if (pool.selectedServer) {
    await pool.loadServerDetails();
  }
};

const onServerHeaderUpdated = async () => {
  console.log("Server header updated successfully");
  // Refresh space data
  if (pool.selectedServer) {
    await pool.loadServerDetails();
  }
};

const updateServerName = async () => {
  if (!currentSpace.value || !serverName.value.trim()) return;

  isUpdating.value = true;

  try {
    // TODO: Implement API call to update server name
    // await api.serverInteraction.UpdateSpaceName(serverName.value);

    toast({
      title: t("server_updated"),
      description: t("server_name_updated"),
    });
  } catch (error) {
    toast({
      title: t("error"),
      description: t("failed_to_update_server"),
      variant: "destructive",
    });
  } finally {
    isUpdating.value = false;
  }
};

const copyServerId = () => {
  if (!currentSpace.value) return;

  navigator.clipboard.writeText(currentSpace.value.spaceId);
  toast({
    title: t("copied"),
    description: t("server_id_copied"),
  });
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const confirmDeleteServer = async () => {
  if (!currentSpace.value || deleteConfirmationName.value !== currentSpace.value.name) return;

  isDeletingServer.value = true;

  try {
    // TODO: Implement API call to delete server
    // await api.serverInteraction.DeleteSpace(currentSpace.value.id);

    toast({
      title: t("server_deleted"),
      description: t("server_deleted_desc"),
    });

    showDeleteServerDialog.value = false;
    // Navigate to home or server list
  } catch (error) {
    toast({
      title: t("error"),
      description: t("failed_to_delete_server"),
      variant: "destructive",
    });
  } finally {
    isDeletingServer.value = false;
  }
};

onMounted(async () => {
  if (pool.selectedServer) {
    currentSpace.value = await pool.getServer(pool.selectedServer);
    
    if (currentSpace.value) {
      serverName.value = currentSpace.value.name;

      // TODO: Load owner username from API
      // const owner = await api.userInteraction.GetUser(currentSpace.value.ownerId);
      // ownerUsername.value = owner.username;
      ownerUsername.value = "Owner"; // Placeholder
    }
  }
});
</script>

<style scoped>
.server-profile-container {
  max-width: 900px;
  margin: 0 auto;
}

.setting-card {
  border-radius: 0.5rem;
  border: 1px solid hsl(var(--border));
  background-color: hsl(var(--card));
  padding: 1.5rem;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
</style>
