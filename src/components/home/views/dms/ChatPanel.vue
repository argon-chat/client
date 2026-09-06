<script setup lang="ts">
import { computed, ref } from "vue";
import CallGrid from "@/components/calls/CallGrid.vue";
import MediaControls from "@/components/MediaControls.vue";
import PingDetailsPopup from "@/components/PingDetailsPopup.vue";
import EmptyStateArt from "@/components/shared/EmptyStateArt.vue";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useLocale } from "@/store/system/localeStore";
import { useMediaLayout } from "@/composables/useMediaLayout";
import { Signal, Users2 } from "lucide-vue-next";

defineEmits<{ (e: "end"): void }>();

const voice = useUnifiedCall();
const { t } = useLocale();

// Same layout as a voice channel, fed from the call's own participants instead of a
// channel's member list. The tiles themselves are rendered by the shared CallGrid.
const layout = useMediaLayout(() => null, "dm");
const { allUsers, qualityConnection } = layout;

const isConnected = computed(() => voice.isConnected);
const isConnecting = computed(() => voice.isConnecting);

const openPingDetails = ref(false);
</script>

<template>
    <div class="dm-call-panel flex flex-col h-full overflow-hidden relative">
        <!-- Top Info Overlay -->
        <div class="media-info-bar">
            <div class="info-pill">
                <Users2 class="w-3.5 h-3.5" />
                <span>{{ allUsers.length }}</span>
            </div>
            <div v-if="isConnected" class="info-pill info-pill--clickable ping-pill-wrapper" :class="'quality-' + qualityConnection.toLowerCase()" @click.stop="openPingDetails = !openPingDetails">
                <Signal class="w-3.5 h-3.5" />
                <PingDetailsPopup
                    :is-open="openPingDetails"
                    :current-ping="voice.ping"
                    :average-ping="voice.averagePing"
                    :ping-history="voice.pingHistory"
                    :quality-connection="qualityConnection"
                />
            </div>
        </div>

        <!-- Content area -->
        <div class="media-content">
            <!-- Nobody yet: the room is still being joined (the dialing screen sits on
                 top of this while the call rings). -->
            <div v-if="allUsers.length === 0" class="empty-state">
                <EmptyStateArt name="no-one-here" :size="164" />
                <span class="empty-state-title">{{ t("connecting") }}</span>
            </div>

            <!-- Participants: the shared stage picks grid or main+strip. -->
            <CallGrid v-else :layout="layout" />
        </div>

        <!-- Controls Block -->
        <MediaControls
            class="mx-3 mb-3"
            :is-connected="isConnected"
            :is-connecting="isConnecting"
            @hangup="$emit('end')"
        />
    </div>
</template>

<style scoped>
.dm-call-panel {
    background: hsl(var(--card) / 0.4);
}

.media-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 1rem;
    gap: 0.75rem;
}

/* Empty state */
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 8px;
    user-select: none;
}

.empty-state-title {
    font-size: 15px;
    font-weight: 600;
    color: hsl(var(--foreground) / 0.6);
}

/* Top info bar */
.media-info-bar {
    position: absolute;
    top: 10px;
    left: 12px;
    display: flex;
    gap: 6px;
    z-index: 10;
}

.info-pill {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: calc(var(--radius) - 4px);
    background: hsl(var(--card) / 0.85);
    backdrop-filter: blur(8px);
    border: 1px solid hsl(var(--border) / 0.3);
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
}

.info-pill--clickable {
    cursor: pointer;
    transition: background 0.15s ease;
}

.info-pill--clickable:hover {
    background: hsl(var(--card));
}

.ping-pill-wrapper {
    position: relative;
}

.ping-pill-wrapper :deep(.ping-popup) {
    bottom: auto;
    top: calc(100% + 8px);
    left: 0;
    transform: none;
}

.info-pill.quality-green { color: #22c55e; }
.info-pill.quality-orange { color: #f97316; }
.info-pill.quality-red { color: #ef4444; }
.info-pill.quality-none { color: hsl(var(--muted-foreground)); }
</style>
