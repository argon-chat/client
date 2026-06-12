<template>
    <div class="space-y-6 storage-settings" v-if="me.me">
        <!-- Storage Usage Card -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <HardDriveIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t('storage_overview') }}</h3>
            </div>
            <UsageStatus
                v-if="usageReport"
                :groups="usageReport.groups"
                :storage-used-bytes="usageReport.storageUsedBytes"
                :disk-total-bytes="diskTotal"
                :disk-free-bytes="diskFree"
            />
        </div>

        <!-- Data Management Section -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <DatabaseIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t('data_management') }}</h3>
            </div>
            
            <div class="space-y-3">
                <!-- Per-category clear actions, driven by the real userData breakdown -->
                <Transition name="card-hover" v-for="g in clearableGroups" :key="g.name">
                    <div class="action-item action-warning">
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                <component :is="metaFor(g.name).icon" class="w-4 h-4" />
                                <span class="text-sm font-medium">{{ label(g.name) }}</span>
                                <span class="text-xs text-muted-foreground tabular-nums">· {{ fmt(g.usedBytes) }}</span>
                            </div>
                            <div class="text-xs text-muted-foreground">
                                {{ t(metaFor(g.name).descKey) }}
                            </div>
                        </div>
                        <Button
                            @click="onClearCategory(g.name)"
                            variant="outline"
                            size="sm"
                            :disabled="clearing !== null"
                            class="shrink-0"
                        >
                            <Loader2Icon v-if="clearing === g.name" class="w-4 h-4 mr-2 animate-spin" />
                            <Trash2Icon v-else class="w-4 h-4 mr-2" />
                            {{ t('clear') }}
                        </Button>
                    </div>
                </Transition>

                <div v-if="clearableGroups.length === 0" class="text-xs text-muted-foreground px-1">
                    {{ t('nothing_to_clear') }}
                </div>
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
import { useMe } from "@/store/auth/meStore";
import { useLocale } from "@/store/system/localeStore";
import { logger } from "@argon/core";
import { useToast } from "@argon/ui/toast";
import { Button } from "@argon/ui/button";
import UsageStatus from "./UsageStatus.vue";
import { computed, onMounted, ref, type Component } from "vue";
import { getStorageUsageReport, StorageUsageReport, pruneStorageCategory, pruneAll } from "@/store/system/fileStorage";
import { native } from "@argon/glue/native";
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
const isWiping = ref(false);
const showConfirmDialog = ref(false);
/** Name of the category currently being cleared, or null. */
const clearing = ref<string | null>(null);
/** Whole-disk context (native only) — used to show real free space. */
const diskTotal = ref(0);
const diskFree = ref(0);

/** Categories the user is allowed to clear, plus their icon + description copy. */
const CATEGORY_META: Record<string, { icon: Component; descKey: string }> = {
    mediaCache: { icon: ImageIcon, descKey: 'clear_media_cache_desc' },
    serviceWorker: { icon: FolderIcon, descKey: 'clear_service_worker_desc' },
    database: { icon: DatabaseIcon, descKey: 'clear_local_db_desc' },
};

const clearableGroups = computed(() =>
    (usageReport.value?.groups ?? []).filter((g) => g.name in CATEGORY_META && g.usedBytes > 0),
);

const metaFor = (name: string) => CATEGORY_META[name] ?? { icon: FolderIcon, descKey: '' };
const label = (name: string) => t(`storage.${name}`);

function fmt(n: number): string {
    const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb'];
    let i = 0, v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    const digits = v < 10 && i > 0 ? 2 : v < 100 && i > 0 ? 1 : 0;
    return `${v.toFixed(digits)} ${units[i]}`;
}

const onClearCategory = async (name: string) => {
    if (clearing.value) return;
    try {
        clearing.value = name;
        await pruneStorageCategory(name);
        // Clearing IndexedDB drops connections the app may still hold — reload.
        if (name === 'database') { location.reload(); return; }
        toast.toast({ title: t('success'), description: t('cache_cleared') });
        usageReport.value = await getStorageUsageReport();
    } catch (error) {
        logger.error("Failed to clear storage category:", error);
        toast.toast({ title: t('error'), description: t('failed_clear_cache'), variant: "destructive" });
    } finally {
        clearing.value = null;
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
        try {
            // @ts-ignore
            const space = await native.hostProc.getStorageSpace();
            diskTotal.value = +space.totalSize || 0;
            diskFree.value = +space.availableFreeSpace || 0;
        } catch { /* disk context is optional */ }
    }
});
</script>
<style scoped>

.storage-settings {
    @apply max-w-5xl mx-auto;
}

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
