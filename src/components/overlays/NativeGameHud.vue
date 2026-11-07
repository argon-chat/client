<script setup lang="ts">
import { computed, onUnmounted, ref, watch, type CSSProperties } from "vue";
import { MicOff, HeadphoneOff, Monitor } from "lucide-vue-next";
import { hudVoice, hudChat, hudConfig, onHudNotification } from "@/lib/shell/overlays";
import { normalizeHudConfig } from "@/lib/overlay/layout";
import type { OverlayNotification, OverlayWidgetType } from "@/lib/overlay/types";

const config = computed(() => normalizeHudConfig(hudConfig.value));
const notices = ref<OverlayNotification[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const expiredChat = ref(new Set<string>());
const chat = computed(() => hudChat.value.filter((message) => !expiredChat.value.has(message.id)).slice(-config.value.chat.maxLines));
function widgetStyle(kind: OverlayWidgetType): CSSProperties {
  const layout = config.value.widgets[kind];
  const anchor = layout.anchor;
  const padding = config.value.screenPadding;
  const right = anchor.endsWith("right");
  const bottom = anchor.startsWith("bottom");
  return {
    position: "absolute",
    [right ? "right" : "left"]: anchor.endsWith("center") ? "50%" : `calc(${padding}px + ${(right ? -1 : 1) * layout.offsetX * 100}vw)`,
    [bottom ? "bottom" : "top"]: `calc(${padding}px + ${(bottom ? -1 : 1) * layout.offsetY * 100}vh)`,
    opacity: layout.opacity * config.value.globalOpacity,
    transform: `${anchor.endsWith("center") ? "translateX(-50%) " : ""}scale(${layout.scale})`,
    transformOrigin: `${right ? "right" : anchor.endsWith("center") ? "center" : "left"} ${bottom ? "bottom" : "top"}`,
  };
}
const off = onHudNotification((notice) => {
  const key = "notice:" + notice.id;
  clearTimeout(timers.get(key));
  const visible = [...notices.value.filter((item) => item.id !== notice.id), notice].slice(-config.value.notifications.maxStack);
  for (const old of notices.value) {
    if (visible.some((item) => item.id === old.id)) continue;
    clearTimeout(timers.get("notice:" + old.id));
    timers.delete("notice:" + old.id);
  }
  notices.value = visible;
  timers.set(key, setTimeout(() => {
    notices.value = notices.value.filter((item) => item.id !== notice.id);
    timers.delete(key);
  }, config.value.notifications.durationMs));
});
let previousFade = -1;
watch([hudChat, () => config.value.chat.fadeAfterMs], ([messages, fadeAfterMs]) => {
  if (previousFade !== fadeAfterMs) {
    for (const [key, timer] of timers) {
      if (!key.startsWith("chat:")) continue;
      clearTimeout(timer); timers.delete(key);
    }
    expiredChat.value = new Set();
    previousFade = fadeAfterMs;
  }
  const ids = new Set(messages.map((message) => message.id));
  expiredChat.value = new Set([...expiredChat.value].filter((id) => ids.has(id)));
  for (const [key, timer] of timers) {
    if (!key.startsWith("chat:") || ids.has(key.slice(5))) continue;
    clearTimeout(timer); timers.delete(key);
  }
  for (const message of messages) {
    const key = "chat:" + message.id;
    if (!fadeAfterMs || timers.has(key) || expiredChat.value.has(message.id)) continue;
    timers.set(key, setTimeout(() => {
      expiredChat.value = new Set([...expiredChat.value, message.id]);
      timers.delete(key);
    }, fadeAfterMs));
  }
}, { immediate: true });
onUnmounted(() => { off(); for (const timer of timers.values()) clearTimeout(timer); timers.clear(); });
</script>

<template>
  <div class="native-hud" aria-hidden="true">
    <div v-if="config.widgets.voice.visible" class="hud-voice" :class="[{ 'hud-card': config.voice.showWidgetBackground }, 'hud-mode-' + config.voice.mode]" :style="widgetStyle('voice')">
      <div v-for="member in hudVoice.members" :key="member.userId" class="hud-member"
        :class="{ 'hud-speaking': member.isSpeaking, 'hud-member-card': config.voice.showMemberCards }">
        <img v-if="member.avatarUrl" :src="member.avatarUrl" class="hud-avatar" />
        <div v-else class="hud-avatar hud-fallback" :style="{ backgroundColor: member.avatarColor }">{{ member.displayName.slice(0, 1) }}</div>
        <span v-if="config.voice.showNames && config.voice.mode !== 'avatars'" class="hud-name">{{ member.displayName }}</span>
        <MicOff v-if="member.isMuted || member.isServerMuted" :size="16" />
        <HeadphoneOff v-if="member.isDeafened || member.isServerDeafened" :size="16" />
        <Monitor v-if="member.isScreenShare" :size="16" />
      </div>
    </div>
    <div v-if="config.widgets.chat.visible && chat.length" class="hud-chat hud-card" :style="widgetStyle('chat')">
      <div v-for="message in chat" :key="message.id" class="hud-message">
        <span :style="{ color: message.authorColor }">{{ message.author }}</span>
        <span>{{ message.text }}</span>
      </div>
    </div>
    <div v-if="config.widgets.notifications.visible" class="hud-notices" :style="widgetStyle('notifications')">
      <div v-for="notice in notices" :key="notice.id" class="hud-card hud-notice">
        <span class="hud-notice-title">{{ notice.title }}</span>
        <span v-if="notice.body">{{ notice.body }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.native-hud { width: 100%; height: 100%; background: transparent; color: #f5f5f5; font-size: 14px; }
.hud-card { padding: 10px; border-radius: 10px; background: #18181be6; }
.hud-voice { display: flex; flex-direction: column; gap: 6px; max-width: 320px; }
.hud-mode-bar, .hud-mode-avatars { flex-direction: row; max-width: none; }
.hud-mode-grid { flex-direction: row; flex-wrap: wrap; width: 320px; }
.hud-member { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 8px; border: 2px solid transparent; }
.hud-member-card { background: #27272acc; }
.hud-speaking { border-color: #6dbb79; }
.hud-avatar { width: 32px; height: 32px; border-radius: 16px; object-fit: cover; }
.hud-fallback { display: flex; align-items: center; justify-content: center; }
.hud-name { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-chat { width: 320px; display: flex; flex-direction: column; gap: 6px; }
.hud-message { display: flex; flex-direction: column; gap: 2px; }
.hud-notices { width: 320px; display: flex; flex-direction: column; gap: 8px; }
.hud-notice { display: flex; flex-direction: column; gap: 3px; }
.hud-notice-title { font-weight: 600; }
</style>
