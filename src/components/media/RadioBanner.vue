<template>
  <div v-if="rows.length > 0" class="radio-banner" data-testid="radio-banner">
    <div v-for="row in rows" :key="row.key" class="radio-row" data-testid="radio-row">
      <span class="radio-emoji" aria-hidden="true">📻</span>
      <span class="radio-hq">{{ row.hqName }}</span>
      <span class="radio-sep" aria-hidden="true">·</span>
      <span class="radio-speaker">{{ row.speakerName }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * "📻 HQ · Alice" — one row per radio participant audible in my room. The broadcast channel
 * is named when I can see it (it is in my channel list); otherwise it is just "Radio". The
 * speaker's name comes from HQ's live roster when they are on it, else from the user store.
 */
import { computed, reactive, watch } from "vue";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useLocale } from "@/store/system/localeStore";

const voice = useUnifiedCall();
const pool = usePoolStore();
const { t } = useLocale();

const spaceId = computed(() => voice.connectedVoiceSpaceId ?? null);
const channels = pool.useActiveServerChannels(spaceId);

const names = reactive(new Map<string, string>());

// A speaker's name is looked up once, when they come on air; the rows below only read.
watch(
  () => voice.radio.onAir.map((s) => s.userId),
  (userIds) => {
    for (const userId of new Set(userIds)) {
      if (names.has(userId)) continue;
      void pool.getUser(userId).then((user) => {
        if (user?.displayName) names.set(userId, user.displayName);
      });
    }
  },
  { immediate: true },
);

function speakerName(userId: string, hqChannelId: string | null): string {
  const live = hqChannelId ? pool.realtimeChannelUsers.get(hqChannelId)?.Users.get(userId)?.User.displayName : undefined;
  return live || names.get(userId) || "…";
}

const rows = computed(() =>
  voice.radio.onAir.map((speaker) => {
    const hq = speaker.hqChannelId ? channels.value.find((c) => c.channelId === speaker.hqChannelId) : undefined;
    return {
      key: `${speaker.hqChannelId ?? "radio"}:${speaker.userId}`,
      hqName: hq?.name ?? t("radio"),
      speakerName: speakerName(speaker.userId, speaker.hqChannelId),
    };
  }),
);

// Names cached for a room are stale for the next one.
watch(spaceId, () => names.clear());
</script>

<style scoped>
.radio-banner {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.radio-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: calc(var(--radius) - 4px);
  background: hsl(var(--card) / 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid hsl(0 84% 60% / 0.35);
  color: hsl(var(--foreground));
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  max-width: 320px;
}

.radio-emoji {
  font-size: 12px;
}

.radio-hq,
.radio-speaker {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.radio-hq {
  font-weight: 600;
}

.radio-sep {
  color: hsl(var(--muted-foreground));
}
</style>
