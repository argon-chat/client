<template>
    <div class="profile-settings text-white rounded-lg space-y-6" v-if="me.me">
        <h2 class="text-2xl font-bold">{{ t("storage") }}</h2>
        <div>
            <div>
                <UsageStatus v-if="usageReport" :groups="usageReport.groups" :quota-bytes="usageReport.quotaBytes"
                    :storage-used-bytes="usageReport.storageUsedBytes" />
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        Wipe databases
                    </div>
                    <div class="text-sm text-muted-foreground">
                        Destroy all data, reset storages (and authorization too)
                    </div>
                </div>
                <button @click="pruneAll(true)"
                    class="button bg-red-500 text-white rounded px-4 py-2 hover:bg-red-600">
                    Wipe
                </button>
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        Wipe cache
                    </div>
                    <div class="text-sm text-muted-foreground">
                        Destroy media cache
                    </div>
                </div>
                <button @click="pruneCache()"
                    class="button bg-orange-800 text-white rounded px-4 py-2 hover:bg-red-600">
                    Wipe
                </button>
            </div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        Wipe System Cache
                    </div>
                    <div class="text-sm text-muted-foreground">
                        Destroy all data in local system cache
                    </div>
                </div>
                <button @click="pruneIndexDb()"
                    class="button bg-orange-800 text-white rounded px-4 py-2 hover:bg-red-600">
                    Wipe
                </button>
            </div>
            <br />
        </div>
    </div>
</template>

<script setup lang="ts">
import { useMe } from "@/store/meStore";
import { useLocale } from "@/store/localeStore";
import { logger } from "@/lib/logger";
import { useToast } from "@/components/ui/toast/";
import UsageStatus from "./UsageStatus.vue";
import { onMounted, ref } from "vue";
import { getStorageUsageReport, StorageUsageReport, pruneCache, pruneIndexDb, pruneAll } from "@/store/fileStorage";
import { native } from "@/lib/glue/nativeGlue";
const { t } = useLocale();
const toast = useToast();

const usageReport = ref(null as StorageUsageReport | null);
const me = useMe();

onMounted(async () => {
    usageReport.value = await getStorageUsageReport();

    if (argon.isArgonHost) {
        const space = await native.hostProc.getStorageSpace();
        usageReport.value.quotaBytes = +space.totalSize;
        usageReport.value.storageUsedBytes = Math.abs(+space.availableFreeSpace - +space.totalSize);
    }
})
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
