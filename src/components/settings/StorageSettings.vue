<template>
    <div class="space-y-6" v-if="me.me">
        <!-- Storage Usage Card -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <HardDriveIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t('storage_overview') }}</h3>
            </div>
            <UsageStatus 
                v-if="usageReport" 
                :groups="usageReport.groups" 
                :quota-bytes="usageReport.quotaBytes"
                :storage-used-bytes="usageReport.storageUsedBytes" 
            />
        </div>

        <!-- Data Management Section -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <DatabaseIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t('data_management') }}</h3>
            </div>
            
            <div class="space-y-3">
                <!-- Clear Media Cache -->
                <Transition name="card-hover">
                    <div class="action-item action-warning">
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                <ImageIcon class="w-4 h-4" />
                                <span class="text-sm font-medium">{{ t('clear_media_cache') }}</span>
                            </div>
                            <div class="text-xs text-muted-foreground">
                                {{ t('clear_media_cache_desc') }}
                            </div>
                        </div>
                        <Button
                            @click="onPruneCache"
                            variant="outline"
                            size="sm"
                            :disabled="isCacheClearing"
                            class="shrink-0"
                        >
                            <Loader2Icon v-if="isCacheClearing" class="w-4 h-4 mr-2 animate-spin" />
                            <Trash2Icon v-else class="w-4 h-4 mr-2" />
                            {{ t('clear') }}
                        </Button>
                    </div>
                </Transition>

                <!-- Clear System Cache -->
                <Transition name="card-hover">
                    <div class="action-item action-warning">
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                <FolderIcon class="w-4 h-4" />
                                <span class="text-sm font-medium">{{ t('clear_system_cache') }}</span>
                            </div>
                            <div class="text-xs text-muted-foreground">
                                {{ t('clear_system_cache_desc') }}
                            </div>
                        </div>
                        <Button
                            @click="onPruneIndexDb"
                            variant="outline"
                            size="sm"
                            :disabled="isSystemCacheClearing"
                            class="shrink-0"
                        >
                            <Loader2Icon v-if="isSystemCacheClearing" class="w-4 h-4 mr-2 animate-spin" />
                            <Trash2Icon v-else class="w-4 h-4 mr-2" />
                            {{ t('clear') }}
                        </Button>
                    </div>
                </Transition>
            </div>
        </div>

        <!-- Danger Zone -->
        <div class="setting-card border-destructive/50">
            <div class="flex items-center gap-2 mb-4">
                <AlertTriangleIcon class="w-5 h-5 text-destructive" />
                <h3 class="text-lg font-semibold text-destructive">{{ t('danger_zone') }}</h3>
            </div>
            
            <div class="action-item action-danger">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <AlertCircleIcon class="w-4 h-4 text-destructive" />
                        <span class="text-sm font-medium">{{ t('reset_all_data') }}</span>
                    </div>
                    <div class="text-xs text-muted-foreground">
                        {{ t('reset_all_data_desc') }}
                    </div>
                </div>
                <Button
                    @click="onConfirmWipeAll"
                    variant="destructive"
                    size="sm"
                    :disabled="isWiping"
                    class="shrink-0"
                >
                    <Loader2Icon v-if="isWiping" class="w-4 h-4 mr-2 animate-spin" />
                    <TrashIcon v-else class="w-4 h-4 mr-2" />
                    {{ t('reset') }}
                </Button>
            </div>
        </div>

        <!-- Confirmation Dialog -->
        <Transition name="dialog-fade">
            <div v-if="showConfirmDialog" class="dialog-overlay" @click="showConfirmDialog = false">
                <div class="dialog-content" @click.stop>
                    <div class="dialog-header">
                        <AlertTriangleIcon class="w-6 h-6 text-destructive" />
                        <h3 class="text-lg font-bold">{{ t('confirm_data_reset') }}</h3>
                    </div>
                    <p class="text-sm text-muted-foreground mb-4">
                        {{ t('confirm_data_reset_question') }}
                    </p>
                    <ul class="text-sm space-y-1 mb-6 list-disc list-inside text-muted-foreground">
                        <li>{{ t('reset_action_logout') }}</li>
                        <li>{{ t('reset_action_delete_messages') }}</li>
                        <li>{{ t('reset_action_remove_media') }}</li>
                        <li>{{ t('reset_action_reset_settings') }}</li>
                    </ul>
                    <div class="flex gap-2 justify-end">
                        <Button @click="showConfirmDialog = false" variant="outline" size="sm">
                            {{ t('cancel') }}
                        </Button>
                        <Button @click="onWipeAll" variant="destructive" size="sm">
                            <TrashIcon class="w-4 h-4 mr-2" />
                            {{ t('yes_reset_everything') }}
                        </Button>
                    </div>
                </div>
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import { useMe } from "@/store/meStore";
import { useLocale } from "@/store/localeStore";
import { logger } from "@/lib/logger";
import { useToast } from "@/components/ui/toast/";
import { Button } from "@/components/ui/button";
import UsageStatus from "./UsageStatus.vue";
import { onMounted, ref } from "vue";
import { getStorageUsageReport, StorageUsageReport, pruneCache, pruneIndexDb, pruneAll } from "@/store/fileStorage";
import { native } from "@/lib/glue/nativeGlue";
import {
    HardDriveIcon,
    DatabaseIcon,
    ImageIcon,
    FolderIcon,
    AlertTriangleIcon,
    AlertCircleIcon,
    TrashIcon,
    Trash2Icon,
    Loader2Icon
} from "lucide-vue-next";

const { t } = useLocale();
const toast = useToast();

const usageReport = ref(null as StorageUsageReport | null);
const me = useMe();
const isCacheClearing = ref(false);
const isSystemCacheClearing = ref(false);
const isWiping = ref(false);
const showConfirmDialog = ref(false);

const onPruneCache = async () => {
    if (isCacheClearing.value) return;
    
    try {
        isCacheClearing.value = true;
        await pruneCache();
        toast.toast({
            title: t('success'),
            description: t('media_cache_cleared'),
        });
        // Refresh usage report
        usageReport.value = await getStorageUsageReport();
    } catch (error) {
        logger.error("Failed to clear cache:", error);
        toast.toast({
            title: t('error'),
            description: t('failed_clear_media_cache'),
            variant: "destructive",
        });
    } finally {
        isCacheClearing.value = false;
    }
};

const onPruneIndexDb = async () => {
    if (isSystemCacheClearing.value) return;
    
    try {
        isSystemCacheClearing.value = true;
        await pruneIndexDb();
        toast.toast({
            title: t('success'),
            description: t('system_cache_cleared'),
        });
        // Refresh usage report
        usageReport.value = await getStorageUsageReport();
    } catch (error) {
        logger.error("Failed to clear system cache:", error);
        toast.toast({
            title: t('error'),
            description: t('failed_clear_system_cache'),
            variant: "destructive",
        });
    } finally {
        isSystemCacheClearing.value = false;
    }
};

const onConfirmWipeAll = () => {
    showConfirmDialog.value = true;
};

const onWipeAll = async () => {
    if (isWiping.value) return;
    
    try {
        isWiping.value = true;
        showConfirmDialog.value = false;
        await pruneAll(true);
        toast.toast({
            title: t('data_reset'),
            description: t('all_data_cleared'),
        });
    } catch (error) {
        logger.error("Failed to wipe data:", error);
        toast.toast({
            title: t('error'),
            description: t('failed_reset_data'),
            variant: "destructive",
        });
    } finally {
        isWiping.value = false;
    }
};

onMounted(async () => {
    usageReport.value = await getStorageUsageReport();

    if (argon.isArgonHost) {
        const space = await native.hostProc.getStorageSpace();
        usageReport.value.quotaBytes = +space.totalSize;
        usageReport.value.storageUsedBytes = Math.abs(+space.availableFreeSpace - +space.totalSize);
    }
});
</script>
<style scoped>
.setting-card {
    @apply rounded-xl border bg-card p-6 shadow-sm transition-all hover:shadow-md;
}

.action-item {
    @apply flex items-center justify-between gap-4 p-4 rounded-lg border transition-all;
}

.action-warning {
    @apply bg-orange-500/5 border-orange-500/20 hover:bg-orange-500/10 hover:border-orange-500/30;
}

.action-danger {
    @apply bg-destructive/5 border-destructive/20 hover:bg-destructive/10 hover:border-destructive/30;
}

.dialog-overlay {
    @apply fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4;
}

.dialog-content {
    @apply bg-card border rounded-xl p-6 max-w-md w-full shadow-2xl;
}

.dialog-header {
    @apply flex items-center gap-2 mb-4;
}

.card-hover-enter-active,
.card-hover-leave-active {
    transition: all 0.2s ease;
}

.card-hover-enter-from,
.card-hover-leave-to {
    opacity: 0;
    transform: translateY(-5px);
}

.dialog-fade-enter-active,
.dialog-fade-leave-active {
    transition: all 0.3s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
    opacity: 0;
}

.dialog-fade-enter-from .dialog-content,
.dialog-fade-leave-to .dialog-content {
    transform: scale(0.95) translateY(-20px);
}

.focus\:ring-ring:focus {
    --tw-ring-color: hsl(0deg 0% 0% / 0%);
}
</style>
