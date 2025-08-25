<template>
    <div class="profile-settings text-white rounded-lg space-y-6" v-if="me.me">
        <h2 class="text-2xl font-bold">{{ t("application_settings") }}</h2>
        <div>
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{ t("close_behaviour") }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{ t("minimize_to_tray") }}
                    </div>
                </div>
                <Switch :disabled="!isArgonHost" :checked="preferenceStore.minimizeToTrayOnClose"
                    @update:checked="(x) => preferenceStore.minimizeToTrayOnClose = x" />
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <label class="block font-semibold mb-1">Dev Tools</label>
                <button @click="toggleDevTools"
                    class="button bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600">
                    Open Dev Tools
                </button>
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        Prune databases
                    </div>
                    <div class="text-sm text-muted-foreground">
                        Destroy all data, reset storages (and authorization too)
                    </div>
                </div>
                <button @click="pruneDatabases(true)"
                    class="button bg-red-500 text-white rounded px-4 py-2 hover:bg-red-600">
                    Prune Databases
                </button>
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        Diagnostic Board
                    </div>
                    <div class="text-sm text-muted-foreground">
                        Open diagnostic control panel
                    </div>
                </div>
                <button class="button bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600">
                    Open Diagnostic Board
                </button>
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        Copy My UserId
                    </div>
                </div>
                <button @click="copyMyUserId" class="button bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600">
                    Copy
                </button>
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        Channel
                    </div>
                    <div class="text-sm text-muted-foreground">
                        Select update channel
                    </div>
                </div>
                <Select v-model="selected_channel">
                    <SelectTrigger class="w-[180px]" :disabled="disable_channel_select">
                        <SelectValue placeholder="Live" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem value="beta">
                                Beta Channel
                            </SelectItem>
                            <SelectItem value="canary" :disabled="true">
                                Canary Channel
                            </SelectItem>
                            <SelectItem value="live">
                                Live
                            </SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        API Endpoint
                    </div>
                    <div class="text-sm text-muted-foreground">
                        (WARNING: after change endpoint all data has been cleared)
                    </div>
                </div>
                <Select v-model="selected_api_endpoint">
                    <SelectTrigger class="w-[180px]">
                        <SelectValue placeholder="Live" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem value="live">
                                Live
                            </SelectItem>
                            <SelectItem value="dev">
                                Development
                            </SelectItem>
                            <SelectItem value="local">
                                Local
                            </SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
            <br />
            <div class="flex flex-col text-gray-500 items-center justify-between rounded-lg border p-4">
                <label class="block font-semibold mb-1">Version: {{ version }}</label>
                <label class="block font-semibold mb-1">Build Time: {{ buildtime }}</label>
                <label class="block font-semibold mb-1">Host Version: {{ host_version ?? 'no-host-mode' }}</label>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useMe } from "@/store/meStore";
import { usePreference } from "@/store/preferenceStore";
import Switch from "../ui/switch/Switch.vue";
import { useLocale } from "@/store/localeStore";
import { onMounted, ref, watch } from "vue";
import { logger } from "@/lib/logger";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast/";
import { useAuthStore } from "@/store/authStore";
const { t } = useLocale();
const toast = useToast();

const me = useMe();
const preferenceStore = usePreference();
const version = ref((window as any).ui_fullversion as string);
const buildtime = ref((window as any).ui_buildtime as string);
const host_version = ref((window as any).argon_host_version_full as string);
const selected_channel = ref("live" as "live" | "canary" | "beta");
const disable_channel_select = ref(false);

const selected_api_endpoint = ref("live" as "live" | "dev" | "local");
const isArgonHost = ref(argon.isArgonHost);

const toggleDevTools = () => {
  native.toggleDevTools();
};

const copyMyUserId = () => {
  toast.toast({
    title: "Your UserId has been copied!",
  });
  navigator.clipboard.writeText(me.me?.userId ?? "error");
};

watch(selected_channel, (e) => {
  native.setChannel(e);
});

watch(selected_api_endpoint, async (e) => {
  if (!e) return;
  if (localStorage.getItem("api_endpoint") === e) return;
  localStorage.setItem("api_endpoint", e);

  useAuthStore().logout();
  await pruneDatabases(false);
});

onMounted(() => {
  if (!argon.isArgonHost) {
    disable_channel_select.value = true;
  } else {
    selected_channel.value = native.getCurrentChannel();
  }

  const currentApiEndpoint = localStorage.getItem("api_endpoint");

  if (currentApiEndpoint) {
    selected_api_endpoint.value = currentApiEndpoint as
      | "live"
      | "dev"
      | "local";
  } else {
    localStorage.setItem("api_endpoint", "live");
  }
});

const pruneDatabases = async (pruneLocalStorage = true) => {
  const allIndexDbs = await indexedDB.databases();

  for (const db of allIndexDbs) {
    try {
      indexedDB.deleteDatabase(db.name ?? "");
    } catch (e) {
      logger.error(e);
    }
  }

  const allStorages = await navigator.storageBuckets.keys();

  for (const storage of allStorages) {
    try {
      navigator.storageBuckets.delete(storage);
    } catch (e) {
      logger.error(e);
    }
  }

  if (pruneLocalStorage) localStorage.clear();

  location.reload();
};
</script>
<style scoped>
.profile-settings {
    max-width: 600px;
    margin: 0 auto;
}

.focus\:ring-ring:focus {
    --tw-ring-color: hsl(0deg 0% 0% / 0%);
}
</style>
