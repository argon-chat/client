<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
    <div
        ref="cardEl"
        class="participant-card group"
        :class="[className, { 'participant-card--playing': isPlaying, 'participant-card--speaking': isSpeaking, 'participant-card--streaming': isScreenSharing, 'participant-card--pinned': isPinned }]"
        :style="customStyle"
        @click="$emit('click', userId)"
        @dblclick="showsVideo && toggleFullscreen()">

        <!-- showsVideo, not hasVideo: a tile the user switched off still has a track,
             it just must not be rendered (or drawn on, or reported as paused).
             @pause: this is a live stream, so there is nothing to pause to — if the UA
             or a PiP window stops it, start it again immediately. -->
        <video
            v-if="showsVideo"
            :ref="(el) => onVideoRef(el)"
            autoplay
            playsinline
            muted
            class="participant-video"
            :style="{ objectFit: videoFit }"
            @pause="resumePlayback" />

        <!-- Adaptive streaming stopped delivering this track, so the picture is a frozen
             last frame — say so rather than letting it read as a stuck stream. -->
        <div v-if="showsVideo && isVideoPaused" class="video-paused-badge">
            <PauseIcon class="w-3 h-3" />
            <span>{{ t('video_paused') }}</span>
        </div>

        <!-- The SFU refused the track; without this the tile is just blank. -->
        <div v-else-if="subscriptionError" class="tile-notice tile-notice--error">
            <TriangleAlertIcon class="w-3.5 h-3.5 shrink-0" />
            <span>{{ subscriptionError }}</span>
        </div>

        <!-- Hover toolbar: full screen and picture-in-picture for this stream. -->
        <div v-if="showsVideo" class="tile-actions" @click.stop>
            <button v-if="canPip" class="tile-action" :title="t('picture_in_picture')" @click="togglePip">
                <PictureInPictureIcon class="w-3.5 h-3.5" />
            </button>
            <button class="tile-action" :title="t('fullscreen')" @click="toggleFullscreen">
                <MaximizeIcon class="w-3.5 h-3.5" />
            </button>
        </div>

        <!-- Live receive stats, on hover only — answers "why does this look bad". -->
        <div v-if="showsVideo && stats" class="tile-stats">
            <span v-if="stats.width && stats.height">{{ stats.width }}×{{ stats.height }}</span>
            <span v-if="stats.codec">{{ stats.codec.toUpperCase() }}</span>
            <span v-if="stats.bitrateKbps">{{ stats.bitrateKbps }} kbps</span>
        </div>

        <!-- Screencast drawing surface (only over a screenshare with an active session). -->
        <DrawOverlay
            v-if="showDrawOverlay"
            :target-id="userId"
            :video="videoEl"
            :fit="videoFit" />

        <!-- Not v-else: the DrawOverlay above sits between this and the <video>, so a
             v-else here chains to the overlay and renders the avatar as a flex sibling
             of a live video instead of a replacement for it. -->
        <ArgonAvatar
            v-if="!showsVideo"
            :user-id="userId"
            :overrided-size="avatarSize"
            :class="[
                'rounded-full transition-all duration-300 ease-in-out group-hover:scale-105',
                { 'ring-2 ring-lime-400/80 shadow-[0_0_20px_rgba(132,255,90,0.6)]': isSpeaking }
            ]" />

        <!-- Bottom name overlay -->
        <div class="participant-overlay" :class="{ 'text-center': centered }">
            <span class="participant-name" :class="nameClass">
                {{ displayName }}
            </span>
        </div>

        <!-- Streaming badge -->
        <div v-if="isScreenSharing" class="streaming-badge">
            <ScreenShareIcon class="w-3 h-3" />
            <span>LIVE</span>
        </div>

        <!-- Status icons -->
        <div class="participant-icons" :class="iconPosition">
            <span v-if="isPoorConnection" class="status-icon status-icon--warning" :title="t('weak_connection')">
                <SignalLowIcon :width="iconSize" :height="iconSize" />
            </span>
            <span v-if="isPlaying" class="status-icon status-icon--playing">
                <Gamepad2Icon :width="iconSize" :height="iconSize" />
            </span>
            <span v-if="isMuted" class="status-icon status-icon--muted">
                <MicOffIcon :width="iconSize" :height="iconSize" />
            </span>
            <span v-if="isHeadphoneMuted" class="status-icon status-icon--muted">
                <HeadphoneOffIcon :width="iconSize" :height="iconSize" />
            </span>
        </div>
    </div>
    </ContextMenuTrigger>

    <ContextMenuContent>
        <ContextMenuItem @select="$emit('toggle-pin', userId)">
            <PinIcon class="w-3.5 h-3.5 mr-2" />
            {{ isPinned ? t('unpin_tile') : t('pin_tile') }}
        </ContextMenuItem>

        <template v-if="showsVideo">
            <ContextMenuItem @select="toggleFullscreen">
                <MaximizeIcon class="w-3.5 h-3.5 mr-2" />
                {{ t('fullscreen') }}
            </ContextMenuItem>
            <ContextMenuItem v-if="canPip" @select="togglePip">
                <PictureInPictureIcon class="w-3.5 h-3.5 mr-2" />
                {{ t('picture_in_picture') }}
            </ContextMenuItem>
        </template>

        <!-- Viewer-side receive controls. Hiding stops the SFU sending this tile at all,
             which is the only way to spend zero bandwidth on someone. -->
        <template v-if="hasVideo || isVideoHidden">
            <ContextMenuSeparator />
            <ContextMenuItem @select="$emit('set-video-hidden', userId, videoSource, !isVideoHidden)">
                <EyeOffIcon class="w-3.5 h-3.5 mr-2" />
                {{ isVideoHidden ? t('show_video') : t('hide_video') }}
            </ContextMenuItem>
            <ContextMenuSub v-if="!isVideoHidden">
                <ContextMenuSubTrigger>
                    <GaugeIcon class="w-3.5 h-3.5 mr-2" />
                    {{ t('receive_quality') }}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                    <ContextMenuItem
                        v-for="q in qualityChoices"
                        :key="q.label"
                        @select="$emit('set-video-quality', userId, videoSource, q.value)">
                        {{ t(q.label) }}
                        <CheckIcon v-if="videoQuality === q.value" class="w-3.5 h-3.5 ml-auto" />
                    </ContextMenuItem>
                </ContextMenuSubContent>
            </ContextMenuSub>
        </template>
    </ContextMenuContent>
  </ContextMenu>
</template>

<script setup lang="ts">
import type { Guid } from "@argon-chat/ion.webcore";
import { computed, ref } from "vue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import DrawOverlay from "@/components/DrawOverlay.vue";
import { useDrawingSession } from "@/store/features/drawingSessionStore";
import { useLocale } from "@/store/system/localeStore";
import { logger } from "@argon/core";
import { VideoQuality } from "livekit-client";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from "@argon/ui/context-menu";
import {
    MicOffIcon, HeadphoneOffIcon, Gamepad2 as Gamepad2Icon, ScreenShare as ScreenShareIcon,
    Pause as PauseIcon, Maximize as MaximizeIcon, PictureInPicture as PictureInPictureIcon,
    SignalLow as SignalLowIcon, TriangleAlert as TriangleAlertIcon, Pin as PinIcon,
    EyeOff as EyeOffIcon, Gauge as GaugeIcon, Check as CheckIcon,
} from "lucide-vue-next";

interface Props {
    userId: Guid;
    displayName: string;
    isSpeaking?: boolean;
    isMuted?: boolean;
    isHeadphoneMuted?: boolean;
    hasVideo?: boolean;
    isVideoPaused?: boolean;
    isVideoHidden?: boolean;
    isScreenSharing?: boolean;
    isPlaying?: boolean;
    isPinned?: boolean;
    /** Server-reported link quality for this participant, if any has arrived yet. */
    connectionQuality?: string | null;
    /** Reason the SFU refused this participant's track, if it did. */
    subscriptionError?: string | null;
    /** Live receive stats for the hover readout. */
    stats?: {
        width: number | null;
        height: number | null;
        codec: string | null;
        bitrateKbps: number | null;
    } | null;
    videoQuality?: VideoQuality;
    avatarSize?: number;
    iconSize?: number;
    className?: string;
    customStyle?: Record<string, any>;
    nameClass?: string;
    iconPosition?: string;
    centered?: boolean;
    videoSource?: string;
    videoFit?: "cover" | "contain";
}

const props = withDefaults(defineProps<Props>(), {
    isSpeaking: false,
    isMuted: false,
    isHeadphoneMuted: false,
    hasVideo: false,
    isVideoPaused: false,
    isVideoHidden: false,
    isScreenSharing: false,
    isPlaying: false,
    isPinned: false,
    connectionQuality: null,
    subscriptionError: null,
    stats: null,
    videoQuality: VideoQuality.HIGH,
    avatarSize: 120,
    iconSize: 24,
    className: '',
    nameClass: 'text-sm',
    iconPosition: 'top-2 right-2',
    centered: true,
    videoSource: 'camera',
    videoFit: 'cover',
});

const emit = defineEmits<{
    (e: 'click', userId: Guid): void;
    (e: 'video-ref', el: any, userId: Guid, source: string): void;
    (e: 'toggle-pin', userId: Guid): void;
    (e: 'set-video-hidden', userId: Guid, source: string, hidden: boolean): void;
    (e: 'set-video-quality', userId: Guid, source: string, quality: VideoQuality): void;
}>();

const draw = useDrawingSession();
const { t } = useLocale();
const videoEl = ref<HTMLVideoElement | null>(null);
const cardEl = ref<HTMLElement | null>(null);

function onVideoRef(el: any): void {
    videoEl.value = (el as HTMLVideoElement) ?? null;
    emit('video-ref', el, props.userId, props.videoSource);
}

/** There is a track AND the local user hasn't switched this tile off. */
const showsVideo = computed(() => props.hasVideo && !props.isVideoHidden);

const isPoorConnection = computed(
    () => props.connectionQuality === 'poor' || props.connectionQuality === 'lost',
);

const qualityChoices = [
    { label: 'quality_high', value: VideoQuality.HIGH },
    { label: 'quality_medium', value: VideoQuality.MEDIUM },
    { label: 'quality_low', value: VideoQuality.LOW },
] as const;

// Element-level PiP. LiveKit's adaptive stream watches for it (ElementInfo.pictureInPicture),
// so a popped-out video keeps receiving even though its tile is no longer on screen.
const canPip = computed(
    () => typeof document !== 'undefined' && !!(document as any).pictureInPictureEnabled,
);

async function togglePip(): Promise<void> {
    const el = videoEl.value;
    if (!el) return;
    try {
        if ((document as any).pictureInPictureElement === el) {
            await (document as any).exitPictureInPicture();
        } else {
            await (el as any).requestPictureInPicture();
        }
    } catch (e) {
        logger.warn('[tile] picture-in-picture failed', e);
    }
}

/**
 * Fullscreen the whole card, never the bare <video>: a video element taken fullscreen
 * gets the UA's own media controls (which is how a live stream ended up pausable), and
 * it would leave the drawing overlay and badges behind. Sizing comes from the
 * :fullscreen rule in the stylesheet, which has to beat the inline tile dimensions.
 */
function toggleFullscreen(): void {
    const el = cardEl.value;
    if (!el) return;
    try {
        if (document.fullscreenElement === el) void document.exitFullscreen();
        else void el.requestFullscreen();
    } catch (e) {
        logger.warn('[tile] fullscreen failed', e);
    }
}

/** A live stream has no meaningful paused state — undo any pause we didn't ask for. */
function resumePlayback(): void {
    void videoEl.value?.play().catch(() => {});
}

// Show the drawing surface only over a screenshare video with an active session.
const showDrawOverlay = computed(() =>
    showsVideo.value &&
    !!props.videoSource && props.videoSource.includes('screen') &&
    draw.isSessionActive(props.userId),
);
</script>

<style scoped>
.participant-card {
    position: relative;
    border-radius: var(--radius);
    overflow: hidden;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.participant-card:hover {
    border-color: hsl(var(--border));
}

.participant-card--speaking {
    border-color: rgba(132, 255, 90, 0.4);
    box-shadow: 0 0 16px rgba(132, 255, 90, 0.3);
}

.participant-card--playing {
    border-color: hsl(160 84% 39% / 0.5);
    box-shadow: 0 0 0 2px hsl(160 84% 39% / 0.1);
}

.participant-card--streaming {
    border-color: hsl(0 84% 60% / 0.5);
    box-shadow: 0 0 12px hsl(0 84% 60% / 0.2);
}

/* The tile carries inline width/height/aspect-ratio from the layout solver, so filling
   the screen needs !important to win over them. */
.participant-card:fullscreen {
    width: 100vw !important;
    height: 100vh !important;
    max-width: none !important;
    max-height: none !important;
    min-width: 0 !important;
    min-height: 0 !important;
    aspect-ratio: auto !important;
    border: none;
    border-radius: 0;
    background: #000;
}

.participant-card:fullscreen .participant-video {
    object-fit: contain !important;
}

/* Deliberately pinned by the user, as opposed to being main because it's the only share. */
.participant-card--pinned {
    border-color: hsl(var(--primary) / 0.7);
    box-shadow: 0 0 12px hsl(var(--primary) / 0.25);
}

.participant-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
}



/* Bottom overlay */
.participant-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(to top, hsl(var(--card) / 0.9), hsl(var(--card) / 0.5) 60%, transparent);
    padding: 1.5rem 0.5rem 0.375rem;
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
}

.participant-name {
    color: hsl(var(--foreground));
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* Streaming badge */
/* Hover-only controls; kept visible while a menu/PiP is open via :focus-within. */
.tile-actions {
    position: absolute;
    top: 6px;
    left: 6px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 6;
}

.participant-card:hover .tile-actions,
.tile-actions:focus-within {
    opacity: 1;
}

.tile-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: hsl(var(--background) / 0.7);
    color: hsl(var(--foreground) / 0.85);
    cursor: pointer;
    backdrop-filter: blur(4px);
    transition: background 0.15s ease, color 0.15s ease;
}

.tile-action:hover {
    background: hsl(var(--background) / 0.9);
    color: hsl(var(--foreground));
}

.tile-stats {
    position: absolute;
    bottom: 6px;
    right: 6px;
    display: flex;
    gap: 6px;
    padding: 2px 6px;
    border-radius: 4px;
    background: hsl(var(--background) / 0.7);
    color: hsl(var(--muted-foreground));
    font-size: 9px;
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
    backdrop-filter: blur(4px);
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
    z-index: 5;
}

.participant-card:hover .tile-stats {
    opacity: 1;
}

.tile-notice {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 90%;
    padding: 6px 10px;
    border-radius: calc(var(--radius) - 4px);
    font-size: 11px;
    line-height: 1.3;
    text-align: left;
}

.tile-notice--error {
    background: hsl(var(--destructive) / 0.15);
    color: hsl(var(--destructive));
}

.video-paused-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    border-radius: 4px;
    background: hsl(var(--background) / 0.75);
    color: hsl(var(--muted-foreground));
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.5px;
    line-height: 1;
    backdrop-filter: blur(4px);
    z-index: 5;
}

.streaming-badge {
    position: absolute;
    top: 6px;
    left: 6px;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    border-radius: 4px;
    background: hsl(0 84% 50%);
    color: white;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    line-height: 1;
    animation: streaming-pulse 2s ease-in-out infinite;
    z-index: 5;
}

@keyframes streaming-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

/* Status icons */
.participant-icons {
    position: absolute;
    display: flex;
    gap: 3px;
}

.status-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    border-radius: 6px;
    background: hsl(var(--card) / 0.75);
    backdrop-filter: blur(4px);
}

.status-icon--muted {
    color: hsl(0 84% 60%);
}

.status-icon--warning {
    color: hsl(38 92% 55%);
}

.status-icon--playing {
    color: hsl(160 84% 39%);
}
</style>
