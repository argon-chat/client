<template>
    <div class="profile-settings text-white rounded-lg space-y-6" v-if="me.me">
        <div v-if="configStore.requiresRestart.size > 0"
            class="mt-6 p-4 rounded-lg border border-yellow-500 text-yellow-400 text-sm">
            {{ t("restart_required_global") }}
        </div>


        <h2 class="text-2xl font-bold">{{ t("application_settings") }}</h2>
        <div class="flex gap-4 flex-col">
            <div v-for="section in configStore.sections" :key="section.section" class="space-y-4">
                <h3 class="text-lg font-semibold" v-if="section.section != 'app'">
                    {{ t(section.section) }}
                </h3>

                <div v-for="key in section.keys" :key="key.key"
                    class="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div class="space-y-0.5">
                        <div class="text-base">
                            {{ t(key.key.toLocaleLowerCase()) }}
                        </div>
                        <div class="text-xs text-gray-400">
                            {{ t(`${key.key.toLocaleLowerCase()}_desc`) }}
                        </div>
                        <div v-if="key.requiredToRestartApp && configStore.requiresRestart.has(`${section.section}:${key.key}`)"
                            class="text-xs text-yellow-400">
                            {{ t("restart_required") }}
                        </div>
                    </div>

                    <Switch v-if="key.type === ConfigPrimitiveType.Boolean" :checked="key.valueB ?? false"
                        @update:checked="v => configStore.setValue(section.section, key, v)" />

                    <input v-else-if="key.type === ConfigPrimitiveType.String" class="input w-[180px]"
                        :value="key.valueStr ?? ''"
                        @change="e => configStore.setValue(section.section, key, (e.target as HTMLInputElement).value)" />

                    <input v-else-if="key.type === ConfigPrimitiveType.Number" type="number" class="input w-[180px]"
                        :value="key.valueNum ?? 0"
                        @change="e => configStore.setValue(section.section, key, Number((e.target as HTMLInputElement).value))" />

                    <input v-else-if="key.type === ConfigPrimitiveType.Double" type="number" step="any" class="input w-[180px]"
                        :value="key.valueF ?? 0"
                        @change="e => configStore.setValue(section.section, key, Number((e.target as HTMLInputElement).value))" />

                    <Select v-else-if="key.type === ConfigPrimitiveType.Enum" :model-value="key.valueEnum!"
                        @update:model-value="v => configStore.setValue(section.section, key, v)">
                        <SelectTrigger class="w-[180px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem v-for="variant in key.valueEnumVariants" :key="variant" :value="variant">
                                    {{ variant }}
                                </SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div  v-if="configStore.devModeEnabled" class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{ t("channel") }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{ t("select_update_channel") }}
                    </div>
                </div>
                <Select v-model="selected_channel">
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
            <div  v-if="configStore.devModeEnabled" class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{ t("api_endpoint") }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{ t("warning_change_endpoint") }}
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
            <div v-if="configStore.devModeEnabled" class="flex flex-row items-center justify-between rounded-lg border p-4">
                <label class="block font-semibold mb-1">{{ t("dev_tools") }}</label>
                <button @click="toggleDevTools"
                    class="button bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600">
                    {{ t("open_dev_tools") }}
                </button>
            </div>
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{ t("copy_my_userid") }}
                    </div>
                </div>
                <button @click="copyMyUserId" class="button bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600">
                    {{ t("copy") }}
                </button>
            </div>
            <div class="flex flex-col text-gray-500 items-center justify-between rounded-lg border p-4">
                <label class="block font-semibold mb-1">{{ t('version_label', { version }) }}</label>
                <label class="block font-semibold mb-1">{{ t('build_time_label', { buildtime }) }}</label>
                <label class="block font-semibold mb-1">{{ t('host_version_label', {
                    host_version: host_version ??
                        'no-host-mode'
                }) }}</label>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useMe } from "@/store/meStore";
import { usePreference } from "@/store/preferenceStore";
import { Switch } from "@argon/ui/switch";
import { useLocale } from "@/store/localeStore";
import { onMounted, ref, watch } from "vue";
import { logger } from "@argon/core";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@argon/ui/select";
import { useToast } from "@argon/ui/toast";
import { useAuthStore } from "@/store/authStore";
import { native } from "@argon/glue/native";
import { Channel, ConfigKeyMetadata_Value, ConfigPrimitiveType, ConfigSectionMetadata_Value, SetRequest } from "@argon/glue/ipc";
import { useConfigStore } from "@/store/configStore";
const { t } = useLocale();
const toast = useToast();

const me = useMe();
const version = ref((window as any).ui_fullversion as string);
const buildtime = ref((window as any).ui_buildtime as string);
const host_version = ref((window as any).argon_host_version_full as string);
const selected_channel = ref("live" as "live" | "canary" | "beta");
const disable_channel_select = ref(false);
const selected_api_endpoint = ref("live" as "live" | "dev" | "local");

const configStore = useConfigStore();
const toggleDevTools = () => {
    native.hostProc.toggleDevTools();
};

const copyMyUserId = () => {
    toast.toast({
        title: t("usedid_copied"),
    });
    
    navigator.clipboard.writeText(me.me?.userId ?? "error");
};

watch(selected_channel, (e) => {
    native.hostProc.setCurrentChannel(Channel[e]);
});

watch(selected_api_endpoint, async (e) => {
    if (!e) return;
    if (localStorage.getItem("api_endpoint") === e) return;
    localStorage.setItem("api_endpoint", e);

    useAuthStore().logout();
    await pruneDatabases(false);
});

onMounted(async () => {
    if (!argon.isArgonHost) {
        disable_channel_select.value = true;
    } else {
        selected_channel.value = Channel[await native.hostProc.getCurrentChannel()] as any;
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
