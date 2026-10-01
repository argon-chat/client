<template>
  <div class="spotify-card" data-testid="spotify-activity">
    <div class="spotify-header">
      <IconBrandSpotify class="w-4 h-4 spotify-green" />
      <span>{{ t("spotify_listening") }}</span>
    </div>

    <div class="spotify-body">
      <img v-if="track.albumArtUrl" :src="track.albumArtUrl" :alt="track.album" class="album-art" draggable="false" />
      <div v-else class="album-art album-art--empty"><IconBrandSpotify class="w-6 h-6" /></div>

      <div class="track-text">
        <button type="button" class="track-title" :title="track.title" @click="openTrack">{{ track.title }}</button>
        <div class="track-artists" :title="artists">{{ artists }}</div>
        <div v-if="track.album" class="track-album" :title="track.album">{{ track.album }}</div>
      </div>
    </div>

    <div class="progress">
      <div class="progress-bar"><div class="progress-fill" :style="{ width: `${progress.fraction * 100}%` }" /></div>
      <div class="progress-times">
        <span>{{ formatTrackTime(progress.positionMs) }}</span>
        <span>{{ formatTrackTime(progress.durationMs) }}</span>
      </div>
    </div>

    <div class="spotify-actions">
      <Button size="sm" variant="secondary" class="flex-1" :disabled="!track.url" @click="openTrack">
        {{ t("spotify_open") }}
      </Button>
      <template v-if="!isOwn">
        <Button v-if="listening" size="sm" variant="outline" class="flex-1" :disabled="busy"
          data-testid="spotify-stop-listening" @click="leave">
          {{ t("spotify_stop_listening") }}
        </Button>
        <Button v-else-if="track.listenAlongOpen" size="sm" class="flex-1 listen-along" :disabled="busy"
          data-testid="spotify-listen-along" @click="join">
          <Loader2 v-if="busy" class="w-3.5 h-3.5 animate-spin" />
          <HeadphonesIcon v-else class="w-3.5 h-3.5" />
          {{ t("spotify_listen_along") }}
        </Button>
      </template>
    </div>

    <div v-if="listenerCount > 0" class="listener-count">
      {{ t("spotify_listeners", { count: listenerCount }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ListenAlongError, type SpotifyTrack } from "@argon/glue";
import { Button } from "@argon/ui/button";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { IconBrandSpotify } from "@tabler/icons-vue";
import { HeadphonesIcon, Loader2 } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";
import { useMe } from "@/store/auth/meStore";
import { LISTEN_ALONG_ERROR_KEYS, useConnectionsStore } from "@/store/features/connectionsStore";
import { formatTrackTime, trackProgress } from "@/lib/connections/providers";
import { openExternalUrl } from "@/lib/linkPreview/openExternal";

const props = defineProps<{ track: SpotifyTrack; hostUserId: string }>();

const { t } = useLocale();
const { toast } = useToast();
const me = useMe();
const connections = useConnectionsStore();

const busy = ref(false);
const now = ref(Date.now());

let clock: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 1000);
  void connections.loadListenAlong();
});

onUnmounted(() => {
  if (clock) clearInterval(clock);
});

const artists = computed(() => props.track.artists.join(", "));
const progress = computed(() => trackProgress(props.track, now.value));
const isOwn = computed(() => me.me?.userId === props.hostUserId);
const listening = computed(() => connections.isListeningAlongWith(props.hostUserId, me.me?.userId));
const listenerCount = computed(() =>
  connections.listenAlong?.hostUserId === props.hostUserId ? connections.listenAlong.listeners.length : 0);

function openTrack() {
  if (props.track.url) openExternalUrl(props.track.url);
}

async function join() {
  busy.value = true;
  try {
    const error = await connections.joinListenAlong(props.hostUserId);
    if (error !== ListenAlongError.NONE)
      toast({ title: t("spotify_listen_along"), description: t(LISTEN_ALONG_ERROR_KEYS[error]), variant: "destructive" });
  } catch (e) {
    logger.error("[connections] listen-along join failed", e);
    toast({ title: t("error"), description: t("listen_along_error_unknown"), variant: "destructive" });
  } finally {
    busy.value = false;
  }
}

async function leave() {
  busy.value = true;
  try {
    await connections.leaveListenAlong();
  } catch (e) {
    logger.warn("[connections] listen-along leave failed", e);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.spotify-card {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.75rem;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, rgb(29 185 84 / 0.16), hsl(var(--muted) / 0.35));
  border: 1px solid rgb(29 185 84 / 0.25);
}

.spotify-header {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: hsl(var(--muted-foreground));
}

.spotify-green {
  color: #1db954;
}

.spotify-body {
  display: flex;
  gap: 0.75rem;
  min-width: 0;
}

.album-art {
  width: 4rem;
  height: 4rem;
  border-radius: 0.375rem;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.3);
}

.album-art--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}

.track-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  gap: 0.125rem;
}

.track-title {
  font-weight: 700;
  font-size: 0.875rem;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-title:hover {
  text-decoration: underline;
}

.track-artists,
.track-album {
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-bar {
  height: 0.25rem;
  border-radius: 9999px;
  background: hsl(var(--foreground) / 0.15);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: hsl(var(--foreground) / 0.85);
  transition: width 1s linear;
}

.progress-times {
  display: flex;
  justify-content: space-between;
  margin-top: 0.25rem;
  font-size: 0.625rem;
  font-variant-numeric: tabular-nums;
  color: hsl(var(--muted-foreground));
}

.spotify-actions {
  display: flex;
  gap: 0.5rem;
}

.listen-along {
  background: #1db954;
  color: #000;
  gap: 0.375rem;
}

.listen-along:hover:not(:disabled) {
  background: #1ed760;
}

.listener-count {
  font-size: 0.6875rem;
  color: hsl(var(--muted-foreground));
  text-align: center;
}
</style>
