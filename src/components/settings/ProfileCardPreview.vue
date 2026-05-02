<template>
  <div class="preview-card" :style="cardGlowStyle">
    <!-- Full-bleed background -->
    <div class="preview-bg">
      <video
        v-if="bgSrc"
        :src="bgSrc"
        autoplay
        loop
        muted
        playsinline
        class="preview-bg-media"
      />
      <div v-else-if="hasColors" class="preview-bg-media" :style="gradientStyle" />
      <div v-else class="preview-bg-media preview-bg-default" />
      <div v-if="bgSrc && primaryTintStyle" class="preview-bg-tint" :style="primaryTintStyle" />
    </div>

    <!-- Hero spacer -->
    <div class="preview-spacer"></div>

    <!-- Glass zone -->
    <div class="preview-glass-zone">
      <div class="preview-frost"></div>
      <div class="preview-shine" :style="glassShineTint"></div>
      <div class="preview-body" :style="glassTintStyle">
        <!-- Avatar overlapping into bg -->
        <div class="preview-header">
          <div class="preview-avatar-anchor">
            <div class="preview-avatar" :class="{ 'preview-avatar--editable': editable }" :style="avatarRingStyle" @click="editable && $emit('clickAvatar')">
              <ArgonAvatar
                :fallback="displayName"
                :file-id="avatarFileId"
                :user-id="userId"
                :overridedSize="56"
              />
              <div v-if="editable" class="preview-avatar-overlay">
                <CameraIcon class="w-5 h-5" />
              </div>
            </div>
          </div>
          <div class="preview-info">
            <div class="preview-name" :style="nameAccentStyle">
              {{ displayName }}
              <IconDiamondFilled v-if="isPremium" class="inline w-3.5 h-3.5 text-violet-400 ml-0.5" />
            </div>
            <div class="preview-username">@{{ username }}</div>
            <div class="preview-status">{{ statusLabel }}</div>
          </div>
        </div>

        <div v-if="customStatus" class="preview-custom-status">{{ customStatus }}</div>
        <div class="preview-roles">
          <span class="preview-role-chip">Role 1</span>
          <span class="preview-role-chip">Role 2</span>
        </div>
        <div v-if="bio" class="preview-bio">{{ bio }}</div>
        <div v-else class="preview-bio preview-bio--placeholder">Your bio appears here...</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { IconDiamondFilled } from "@tabler/icons-vue";
import { CameraIcon } from "lucide-vue-next";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { argbToRgba, getBackgroundSrc } from "@/lib/profileCustomization";
import { useLocale } from "@/store/system/localeStore";

const { t } = useLocale();

const props = withDefaults(defineProps<{
  displayName: string;
  username: string;
  userId: string;
  avatarFileId: string | null;
  isPremium: boolean;
  customStatus?: string | null;
  bio?: string | null;
  primaryColor: number | null;
  accentColor: number | null;
  backgroundId: number | null;
  editable?: boolean;
}>(), {
  editable: false,
});

defineEmits<{
  clickAvatar: [];
}>();

const bgSrc = computed(() => getBackgroundSrc(props.backgroundId));
const hasColors = computed(() => props.primaryColor != null || props.accentColor != null);

const statusLabel = computed(() => t("status_online") || "Online");

const gradientStyle = computed(() => {
  const primary = props.primaryColor ? argbToRgba(props.primaryColor) : "hsl(var(--muted))";
  const accent = props.accentColor ? argbToRgba(props.accentColor) : primary;
  return { background: `linear-gradient(135deg, ${primary}, ${accent})` };
});

const primaryTintStyle = computed(() => {
  if (!props.primaryColor) return null;
  const color = argbToRgba(props.primaryColor);
  return { background: color.replace(/[\d.]+\)$/, "0.2)") };
});

const glassTintStyle = computed(() => {
  if (!props.primaryColor) return {};
  const color = argbToRgba(props.primaryColor);
  return { background: `linear-gradient(180deg, ${color.replace(/[\d.]+\)$/, "0.10)")}, transparent 60%)` };
});

const glassShineTint = computed(() => {
  if (!props.accentColor) return {};
  const accent = argbToRgba(props.accentColor);
  return { background: `linear-gradient(90deg, transparent, ${accent.replace(/[\d.]+\)$/, "0.3)")}, transparent)` };
});

const cardGlowStyle = computed(() => {
  if (!props.accentColor) return {};
  const accent = argbToRgba(props.accentColor);
  const outerGlow = accent.replace(/[\d.]+\)$/, "0.25)");
  const midGlow = accent.replace(/[\d.]+\)$/, "0.12)");
  const innerBorder = accent.replace(/[\d.]+\)$/, "0.2)");
  return { boxShadow: `0 0 24px ${outerGlow}, 0 0 48px ${midGlow}, inset 0 0 0 1px ${innerBorder}` };
});

const avatarRingStyle = computed(() => {
  if (!props.accentColor) return {};
  const accent = argbToRgba(props.accentColor);
  const glow = accent.replace(/[\d.]+\)$/, "0.4)");
  return { borderColor: accent, boxShadow: `0 0 10px ${glow}` };
});

const nameAccentStyle = computed(() => {
  if (!props.accentColor) return {};
  const accent = argbToRgba(props.accentColor);
  return { color: accent };
});
</script>

<style scoped>
.preview-card {
  position: relative;
  width: 320px;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--card));
  transition: box-shadow 0.3s ease;
}

/* Full-bleed background */
.preview-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.preview-bg-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-bg-default {
  background: linear-gradient(160deg, hsl(var(--muted) / 0.5) 0%, hsl(var(--card)) 100%);
}

.preview-bg-tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
  mix-blend-mode: overlay;
}

/* Hero spacer */
.preview-spacer {
  position: relative;
  height: 90px;
  z-index: 1;
}

/* Glass zone */
.preview-glass-zone {
  position: relative;
  z-index: 2;
}

.preview-frost {
  height: 22px;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  background: linear-gradient(
    to bottom,
    hsl(var(--card) / 0) 0%,
    hsl(var(--card) / 0.35) 40%,
    hsl(var(--card) / 0.7) 100%
  );
  mask-image: linear-gradient(to bottom, transparent 0%, black 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 100%);
}

.preview-shine {
  height: 1px;
  background: linear-gradient(90deg, transparent, hsl(var(--foreground) / 0.08), transparent);
}

.preview-body {
  background: hsl(var(--card) / 0.92);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  padding: 0 12px 12px;
}

/* Profile header with overlapping avatar */
.preview-header {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 10px;
}

.preview-avatar-anchor {
  flex-shrink: 0;
  margin-top: -32px;
}

.preview-avatar {
  position: relative;
  border-radius: 50%;
  padding: 2px;
  border: 2.5px solid hsl(var(--card) / 0.9);
  background: hsl(var(--card) / 0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 3px 12px hsl(var(--background) / 0.4);
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
  line-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-avatar--editable {
  cursor: pointer;
}

.preview-avatar-overlay {
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  background: hsl(var(--background) / 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--foreground));
  opacity: 0;
  transition: opacity 0.15s ease;
}

.preview-avatar--editable:hover .preview-avatar-overlay {
  opacity: 1;
}

.preview-info {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  padding-bottom: 2px;
}

.preview-name {
  font-size: 0.92rem;
  font-weight: 700;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.3s ease;
}

.preview-username {
  font-size: 0.65rem;
  color: hsl(var(--foreground) / 0.5);
}

.preview-status {
  font-size: 0.68rem;
  color: #4ade80;
  font-weight: 600;
}

.preview-custom-status {
  font-size: 0.7rem;
  color: hsl(var(--foreground) / 0.6);
  font-style: italic;
  margin-bottom: 6px;
}

.preview-roles {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.preview-role-chip {
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 0.62rem;
  background: hsl(var(--background) / 0.4);
  color: hsl(var(--muted-foreground));
  border: 1px solid hsl(var(--border) / 0.25);
}

.preview-bio {
  font-size: 0.72rem;
  color: hsl(var(--foreground) / 0.8);
  line-height: 1.4;
  background: hsl(var(--background) / 0.3);
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.15);
}

.preview-bio--placeholder {
  color: hsl(var(--muted-foreground) / 0.4);
  font-style: italic;
}
</style>
