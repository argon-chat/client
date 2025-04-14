<template>
    <div class="profile-settings p-6  text-white rounded-lg space-y-6" v-if="me.me">
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
                <Switch :checked="preferenceStore.minimizeToTrayOnClose"
                    @update:checked="(x) => preferenceStore.minimizeToTrayOnClose = x" />
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <label class="block font-semibold mb-1">Dev Tools</label>
                <button @click="toggleDevTools" class="button bg-red-500 text-white rounded px-4 py-2 hover:bg-red-600">
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
                <button @click="pruneDatabases" class="button bg-red-500 text-white rounded px-4 py-2 hover:bg-red-600">
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
                <button class="button bg-red-500 text-white rounded px-4 py-2 hover:bg-red-600">
                    Open Diagnostic Board
                </button>
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
import { useMe } from '@/store/meStore';
import { usePreference } from '@/store/preferenceStore';
import Switch from '../ui/switch/Switch.vue';
import { useLocale } from '@/store/localeStore';
import { ref } from 'vue';
import { logger } from '@/lib/logger';
const { t } = useLocale();

const me = useMe();
const preferenceStore = usePreference();
const version = ref((window as any).ui_fullversion as string);
const buildtime = ref((window as any).ui_buildtime as string);
const host_version = ref((window as any).argon_host_version_full as string);

const toggleDevTools = () => {
    native.toggleDevTools();
}

const pruneDatabases = async () => {
    const allIndexDbs = await indexedDB.databases();

    for (let db of allIndexDbs) {
        try {
            indexedDB.deleteDatabase(db.name!);
        } catch (e) {
            logger.error(e);
        }
    }

    const allStorages = await navigator.storageBuckets.keys();


    for (let storage of allStorages) {
        try {
            navigator.storageBuckets.delete(storage);
        } catch (e) {
            logger.error(e);
        }
    }

    localStorage.clear();

    location.reload();
}

</script>
<style scoped>
.profile-settings {
    max-width: 600px;
    margin: 0 auto;
}
</style>
