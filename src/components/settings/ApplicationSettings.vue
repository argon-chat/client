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
                <label class="block font-semibold mb-1">{{ t("dev_tools") }}</label>
                <button @click="toggleDevTools"
                    class="button bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600">
                    {{ t("open_dev_tools") }}
                </button>
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{t("diagnostic_board")}}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{t("diagnostic_control_board_open")}}  
                    </div>
                </div>
                <button class="button bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600">
                    {{t("diagnostic_board_open")}} 
                </button>
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                       {{t("copy_my_userid")}}
                    </div>
                </div>
                <button @click="copyMyUserId" class="button bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600">
                    {{t("copy")}}
                </button>
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                    {{ t("channel") }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{t("select_update_channel")}}
                    </div>
                </div>
                <Select v-model="selected_channel">
<!-- ne eby dumai  -->
                    <SelectTrigger class="w-[180px]" :disabled="disable_channel_select">
                        <SelectValue :placeholder="t('select_channel_placeholder')" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem value="beta">
                                {{ t('beta_channel') }}
                            </SelectItem>
                            <SelectItem value="canary" :disabled="true">
                                {{ t('canary_channel') }}
                            </SelectItem>
                            <SelectItem value="live">
                                {{ t('live_channel') }}
                            </SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                       {{ t("api_endpoint") }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{t("warning_change_endpoint")  }}
                    </div>
                </div>
                <Select v-model="selected_api_endpoint">
                        <SelectTrigger class="w-[180px]">
                            <SelectValue :placeholder="t('select_api_endpoint_placeholder')" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="live">
                                    {{ t('live_endpoint') }}
                                </SelectItem>
                                <SelectItem value="dev">
                                    {{ t('dev_endpoint') }}
                                </SelectItem>
                                <SelectItem value="local">
                                    {{ t('local_endpoint') }}
                                </SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>

            </div>
            <br />
            <div class="flex flex-col text-gray-500 items-center justify-between rounded-lg border p-4">
                <label class="block font-semibold mb-1">{{ t('version_label', { version }) }}</label>
                <label class="block font-semibold mb-1">{{ t('build_time_label', { buildtime }) }}</label>
                <label class="block font-semibold mb-1">{{ t('host_version_label', { host_version: host_version ?? 'no-host-mode' }) }}</label>
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
    title: t("usedid_copied"),
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
