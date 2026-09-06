<template>
    <Transition name="stream-layout" mode="out-in">
        <!-- Stream mode: one main tile (a share, or whoever is pinned) and everyone
             else in a single-row strip under it. -->
        <div v-if="hasActiveStream && mainStreamer" key="stream-mode" class="call-grid call-grid--stream">
            <div ref="mainArea" data-area="main" class="call-grid__main">
                <ParticipantCard
                    :user-id="mainStreamer.User.userId"
                    :display-name="mainStreamer.User.displayName"
                    :is-speaking="isSpeaking(mainStreamer.User.userId)"
                    :is-muted="isMuted(mainStreamer.User.userId)"
                    :is-headphone-muted="isHeadphoneMuted(mainStreamer.User.userId)"
                    :is-screen-sharing="isScreenSharing(mainStreamer.User.userId)"
                    :is-playing="isPlayingActivity(mainStreamer.User.userId)"
                    :has-video="hasVideo(mainStreamer.User.userId)"
                    v-bind="tileProps(mainStreamer.User.userId, 'screen_share')"
                    :avatar-size="180"
                    :custom-style="tileStyle(mainTile, mainRatio)"
                    name-class="text-base"
                    :centered="false"
                    video-fit="contain"
                    icon-position="top-2 left-2"
                    @toggle-pin="toggleFocus"
                    @set-video-hidden="setVideoHidden"
                    @set-video-quality="setVideoQuality"
                    @video-ref="setVideoRef" />
            </div>

            <div
                v-if="stripCount > 0"
                ref="stripArea"
                data-area="strip"
                class="call-grid__strip"
                :style="{ gap: STRIP_GAP + 'px' }">
                <ParticipantCard
                    v-for="[userId, user] in otherUsers"
                    :key="userId"
                    :user-id="userId"
                    :display-name="user.User.displayName"
                    :is-speaking="isSpeaking(userId)"
                    :is-muted="isMuted(userId)"
                    :is-headphone-muted="isHeadphoneMuted(userId)"
                    :is-screen-sharing="isScreenSharing(userId)"
                    :is-playing="isPlayingActivity(userId)"
                    :has-video="hasVideo(userId)"
                    v-bind="tileProps(userId, 'camera')"
                    :avatar-size="90"
                    :icon-size="18"
                    class-name="flex-shrink-0"
                    :custom-style="tileStyle(strip)"
                    name-class="text-xs"
                    icon-position="top-1 right-1"
                    @click="toggleFocus"
                    @toggle-pin="toggleFocus"
                    @set-video-hidden="setVideoHidden"
                    @set-video-quality="setVideoQuality"
                    @video-ref="setVideoRef" />
                <ActivityCard
                    v-for="a in activities"
                    :key="a.sessionId"
                    :presence="a"
                    class-name="flex-shrink-0"
                    :custom-style="tileStyle(strip)" />
            </div>
        </div>

        <!-- Grid mode: equal 16:9 tiles that fill the area for any count. -->
        <div
            v-else
            key="grid-mode"
            ref="gridArea"
            data-area="grid"
            class="call-grid call-grid--tiles"
            :style="{ gap: GRID_GAP + 'px' }">
            <ParticipantCard
                v-for="[userId, user] in allUsers"
                :key="userId"
                :user-id="userId"
                :display-name="user.User.displayName"
                :is-speaking="isSpeaking(userId)"
                :is-muted="isMuted(userId)"
                :is-headphone-muted="isHeadphoneMuted(userId)"
                :is-screen-sharing="isScreenSharing(userId)"
                :is-playing="isPlayingActivity(userId)"
                :has-video="hasVideo(userId)"
                v-bind="tileProps(userId, 'camera')"
                class-name="flex-shrink-0"
                :custom-style="tileStyle(grid)"
                @click="toggleFocus"
                @toggle-pin="toggleFocus"
                @set-video-hidden="setVideoHidden"
                @set-video-quality="setVideoQuality"
                @video-ref="setVideoRef" />
            <ActivityCard
                v-for="a in activities"
                :key="a.sessionId"
                :presence="a"
                class-name="flex-shrink-0"
                :custom-style="tileStyle(grid)" />
        </div>
    </Transition>
</template>

<script lang="ts">
/** Gap between grid tiles (px). Fed to the solver and to the flex container together. */
export const GRID_GAP = 16;
/** Gap between strip tiles (px). */
export const STRIP_GAP = 12;
/** A tile never grows past this, however wide the window is. */
export const MAX_TILE_WIDTH = 720;
/** A tile never shrinks under this; the area scrolls instead. */
export const MIN_TILE_WIDTH = 150;
</script>

<script setup lang="ts">
/**
 * The participant tiles of a call — shared by voice channels and direct calls.
 *
 * Both views used to lay tiles out on their own, and the DM one had drifted into fixed
 * rem boxes, a special case for exactly two people and a main tile with no shape of its
 * own. There is one layout now: every region is measured, and the solver picks tile
 * dimensions that fill it at the tile's ratio without overflowing on either axis. The
 * parents keep what really differs — the header, the empty state, the game stage and
 * the controls — and hand this component the layout they built.
 */
import { computed, ref, type PropType } from "vue";
import { useElementSize } from "@vueuse/core";
import ParticipantCard from "@/components/home/views/ParticipantCard.vue";
import ActivityCard from "@/components/playframe/ActivityCard.vue";
import { useResponsiveGrid, tileStyle } from "@/composables/useResponsiveGrid";
import { useVideoTrackAttach } from "@/composables/useVideoTrackAttach";
import type { MediaLayout } from "@/composables/useMediaLayout";
import type { ActivityPresence } from "@/store/features/playframeStore";

const props = defineProps({
    /** The call's layout state, built once by the parent with `useMediaLayout`. */
    layout: { type: Object as PropType<MediaLayout>, required: true },
    /** Activities other people started, shown as joinable tiles among the participants. */
    activities: { type: Array as PropType<ActivityPresence[]>, default: () => [] },
});

// The parent creates the layout once for the lifetime of the call view and never swaps
// it, so its members are taken here once rather than re-read through the prop per render.
const {
    allUsers,
    mainStreamer,
    otherUsers,
    hasActiveStream,
    isSpeaking,
    hasVideo,
    tileProps,
    setVideoHidden,
    setVideoQuality,
    videoAspectRatio,
    isScreenSharing,
    isMuted,
    isHeadphoneMuted,
    isPlayingActivity,
    toggleFocus,
} = props.layout;

const { setVideoRef } = useVideoTrackAttach();

// Each region is measured and solved on its own: the solver only ever returns tiles that
// fit the measured box, so nothing here can grow past the screen.
const gridArea = ref<HTMLElement | null>(null);
const stripArea = ref<HTMLElement | null>(null);
const mainArea = ref<HTMLElement | null>(null);
const { width: gW, height: gH } = useElementSize(gridArea);
const { width: sW, height: sH } = useElementSize(stripArea);
const { width: mW, height: mH } = useElementSize(mainArea);

// Participant tiles and activity tiles share the grid; only the non-main ones fill the strip.
const gridCount = computed(() => allUsers.value.length + props.activities.length);
const stripCount = computed(() => otherUsers.value.length + props.activities.length);

const grid = useResponsiveGrid({
    width: gW, height: gH, count: gridCount,
    gap: GRID_GAP, maxTileWidth: MAX_TILE_WIDTH, minTileWidth: MIN_TILE_WIDTH,
});
const strip = useResponsiveGrid({ width: sW, height: sH, count: stripCount, gap: STRIP_GAP, singleRow: true });
// The main tile follows the real shape of the incoming picture, so an ultrawide or
// portrait share isn't letterboxed inside a fixed 16:9 box.
const mainRatio = computed(() => videoAspectRatio(mainStreamer.value?.User.userId));
const mainTile = useResponsiveGrid({ width: mW, height: mH, count: 1, ratio: mainRatio });
</script>

<style scoped>
.call-grid {
    flex: 1;
    min-height: 0;
    width: 100%;
}

.call-grid--stream {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.call-grid__main {
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}

.call-grid__strip {
    display: flex;
    flex-direction: row;
    flex-shrink: 0;
    width: 100%;
    height: clamp(6rem, 18%, 11rem);
    overflow-x: auto;
    overflow-y: hidden;
}

.call-grid--tiles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    align-content: center;
    justify-content: center;
    overflow-y: auto;
}

/* Grid <-> stream switch */
.stream-layout-enter-active,
.stream-layout-leave-active {
    transition: all 0.25s ease-in-out;
}

.stream-layout-enter-from {
    opacity: 0;
    transform: translateY(-20px) scale(0.95);
}

.stream-layout-leave-to {
    opacity: 0;
    transform: translateY(20px) scale(0.95);
}

.stream-layout-enter-to,
.stream-layout-leave-from {
    opacity: 1;
    transform: translateY(0) scale(1);
}
</style>
