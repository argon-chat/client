<template>
    <Drawer :open="windows.channelSettingsOpen" :dismissible="false">
        <DrawerContent class="sm:min-h-[95%] h-2 p-4 sm:px-40" :trap-focus="false" :auto-focus="false">
            <DrawerHeader class="grid grid-cols-[1fr_auto] items-start gap-4">
                <div class="min-w-0">
                    <DrawerTitle class="flex items-center gap-2">
                        <component :is="channelIcon" class="w-5 h-5 text-muted-foreground shrink-0" />
                        <span class="truncate">{{ channel?.name ?? t("channel_settings") }}</span>
                    </DrawerTitle>
                    <DrawerDescription>{{ t("channel_settings_desc") }}</DrawerDescription>
                </div>

                <button @click="windows.closeChannelSettings()" class="close-button icon-motion icon-motion--pop">
                    <CircleXIcon class="w-10 h-10" />
                </button>
            </DrawerHeader>

            <div class="settings-layout justify-center flex flex-1 space-x-4">
                <nav class="settings-nav flex-shrink-0 w-48 p-3 space-y-1 rounded-lg isolate">
                    <button
                        v-for="tab in tabs"
                        :key="tab.id"
                        class="nav-item"
                        :class="{ 'nav-item--active': windows.channelSettingsTab === tab.id }"
                        @click="windows.channelSettingsTab = tab.id"
                    >
                        <component :is="tab.icon" class="w-4 h-4 shrink-0" />
                        <span>{{ t(tab.label) }}</span>
                    </button>
                </nav>
                <div class="settings-content flex-1 p-6 pb-8 text-foreground overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
                    <TabTransition>
                        <component
                            v-if="channel && activeTab"
                            :is="activeTab.component"
                            :key="`${activeTab.id}:${channel.channelId}`"
                            :channel="channel" />
                    </TabTransition>
                </div>
            </div>
        </DrawerContent>
    </Drawer>
</template>

<script setup lang="ts">
/**
 * The channel settings drawer — the channel-level twin of ServerSettingsWindow.
 *
 * One instance for the whole app, told by the window store which channel to edit. The channel
 * row is followed live from the local database so a rename made elsewhere shows in the header
 * and in the form, and a deletion closes the drawer instead of leaving it editing a ghost.
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { liveQuery, type Subscription } from "dexie";
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerDescription,
} from "@argon/ui/drawer";
import {
    CircleXIcon, SlidersHorizontalIcon, ShieldIcon, HashIcon, Volume2Icon, AntennaIcon,
} from "lucide-vue-next";
import { logger } from "@argon/core";
import { ChannelType, type ArgonChannel } from "@argon/glue";
import { db } from "@/store/db/dexie";
import { useWindow, type ChannelSettingsTab } from "@/store/ui/windowStore";
import { useLocale } from "@/store/system/localeStore";
import TabTransition from "@/components/shared/TabTransition.vue";
import ChannelOverview from "@/components/settings/channels/ChannelOverview.vue";
import ChannelPermissions from "@/components/settings/channels/ChannelPermissions.vue";

const windows = useWindow();
const { t } = useLocale();

const tabs: { id: ChannelSettingsTab; label: string; icon: unknown; component: unknown }[] = [
    { id: "overview", label: "overview", icon: SlidersHorizontalIcon, component: ChannelOverview },
    { id: "permissions", label: "channel_permissions", icon: ShieldIcon, component: ChannelPermissions },
];

const activeTab = computed(() => tabs.find((tab) => tab.id === windows.channelSettingsTab) ?? tabs[0]);

const channel = ref<ArgonChannel | null>(null);
let sub: Subscription | null = null;

watch(
    () => [windows.channelSettingsOpen, windows.channelSettingsChannelId] as const,
    ([open, id]) => {
        sub?.unsubscribe();
        sub = null;
        if (!open || !id) {
            channel.value = null;
            return;
        }
        sub = liveQuery(() => db.channels.get(id)).subscribe({
            next: (row) => {
                if (row) channel.value = row;
                // It was here and now it is not: deleted, from the danger zone or by somebody else.
                else if (channel.value) windows.closeChannelSettings();
            },
            error: (e) => logger.error("[ChannelSettings] channel query failed", e),
        });
    },
    { immediate: true },
);

const channelIcon = computed(() => {
    switch (channel.value?.type) {
        case ChannelType.Voice: return Volume2Icon;
        case ChannelType.Announcement: return AntennaIcon;
        default: return HashIcon;
    }
});

const handleEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && windows.channelSettingsOpen) {
        windows.closeChannelSettings();
    }
};

onMounted(() => {
    window.addEventListener("keydown", handleEscape);
});

onUnmounted(() => {
    window.removeEventListener("keydown", handleEscape);
    sub?.unsubscribe();
});
</script>

<style scoped>
.settings-layout {
    height: 100%;
}

.settings-nav {
    display: flex;
    flex-direction: column;
}

.nav-item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.9rem;
    color: hsl(var(--muted-foreground));
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}

.nav-item:hover {
    background: hsl(var(--accent) / 0.6);
    color: hsl(var(--foreground));
}

.nav-item--active {
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
}

.settings-content {
    border-radius: var(--radius);
    max-width: 900px;
}

.close-button {
    color: hsl(var(--muted-foreground));
    background: transparent;
    border: none;
    cursor: pointer;
}

.close-button:hover {
    color: hsl(var(--foreground));
}
</style>
