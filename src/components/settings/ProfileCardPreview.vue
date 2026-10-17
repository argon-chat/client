<template>
  <!--
    Room around the card for whatever a worn frame hangs outside it.

    A wrapper with padding rather than a margin on the card itself, and that is not a stylistic
    preference: this sits inside a `space-y-*` container, whose `> * + *` rule is more specific than
    any scoped class here and had been quietly winning. A padding is nobody else's property.
  -->
  <div class="preview-room" :style="roomStyle">
  <div class="preview-card" :style="cardGlowStyle">
    <!-- Full-bleed background -->
    <div class="preview-bg">
      <div v-if="hasColors" class="preview-bg-media" :style="gradientStyle" />
      <div v-else class="preview-bg-media preview-bg-default" />
    </div>

    <!--
      Over everything on the card: the frame around it. Outside the background wrapper on purpose —
      that one is under the card's own contents, and a frame's whole point is that it is not.
    -->
    <CosmeticSurface
      surface="profileCard"
      :profile="profile"
      :primitives="OVERLAY_PRIMITIVES"
    />

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
              <img
                v-if="avatarPreview"
                :src="avatarPreview"
                class="w-14 h-14 rounded-full object-cover"
              />
              <ArgonAvatar
                v-else
                :fallback="displayName"
                :file-id="avatarFileId"
                :user-id="userId"
                :overridedSize="56"
                :profile="profile"
              />
              <!-- Upload spinner -->
              <div v-if="avatarPreview && !avatarUploadFailed" class="preview-avatar-overlay" style="opacity: 1">
                <Loader2 class="w-5 h-5 animate-spin" />
              </div>
              <!-- Upload failed -->
              <div v-else-if="avatarPreview && avatarUploadFailed" class="preview-avatar-overlay" style="opacity: 1; background: rgba(239, 68, 68, 0.6)">
                <X class="w-6 h-6" :stroke-width="3" />
              </div>
              <!-- Editable hover -->
              <div v-else-if="editable" class="preview-avatar-overlay">
                <CameraIcon class="w-5 h-5" />
              </div>
            </div>
          </div>
          <div class="preview-info">
            <CosmeticNickname class="preview-name" surface="profileCard" :profile="profile" :fallback-color="nameAccentColor">
              {{ displayName }}
            </CosmeticNickname>
            <div class="preview-username">
              @{{ username }}
              <!-- Beside the handle rather than inside the name: a styled name paints its own letters, and a mark in there would be painted with them. -->
              <IconDiamondFilled v-if="isPremium" class="inline w-3.5 h-3.5 text-violet-400 ml-0.5" />
            </div>
            <div class="preview-status">{{ statusLabel }}</div>
          </div>
        </div>

        <div v-if="hasStatus" class="preview-custom-status" data-testid="preview-custom-status">
          <StatusEmoji :profile="statusIcon" :size="14" animate-on="always" />
          <span v-if="customStatus" class="preview-custom-status__text">{{ customStatus }}</span>
        </div>
        <div class="preview-roles">
          <span class="preview-role-chip">Role 1</span>
          <span class="preview-role-chip">Role 2</span>
        </div>
        <div v-if="bio" class="preview-bio">{{ bio }}</div>
        <div v-else class="preview-bio preview-bio--placeholder">Your bio appears here...</div>
      </div>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { IconDiamondFilled } from "@tabler/icons-vue";
import { CameraIcon, Loader2, X } from "lucide-vue-next";
import type { ArgonUserProfile, StatusEmoji as StatusEmojiData } from "@argon/glue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import CosmeticNickname from "@/cosmetics/CosmeticNickname.vue";
import CosmeticSurface from "@/cosmetics/CosmeticSurface.vue";
import type { RenderPrimitive } from "@/cosmetics/types";
import { useCosmeticFit } from "@/composables/useCosmeticFit";
import { argbToRgba, shadeArgb } from "@/lib/profileCustomization";
import { useLocale } from "@/store/system/localeStore";
import { persistedValue } from "@argon/storage";
import StatusEmoji from "@/components/expressions/StatusEmoji.vue";
import { hasCustomStatus } from "@/lib/statusIcon";

const { t } = useLocale();

const props = withDefaults(defineProps<{
  displayName: string;
  username: string;
  userId: string;
  avatarFileId: string | null;
  isPremium: boolean;
  customStatus?: string | null;
  /** As on the profile: "" or null for none, a unicode emoji, or `ce:<itemId>` with its emoji. */
  customStatusIconId?: string | null;
  customStatusEmoji?: StatusEmojiData | null;
  bio?: string | null;
  primaryColor: number | null;
  accentColor: number | null;

  /**
   * What is actually being worn, for the parts of the card that are cosmetics rather than settings.
   *
   * The saved profile rather than a speculative one: equipping goes through the server, which
   * broadcasts, which refreshes this. So the preview shows what other people would see, which is the
   * only thing it is for.
   */
  profile?: Pick<ArgonUserProfile, "cosmetics"> | null;

  editable?: boolean;
  avatarPreview?: string | null;
  avatarUploadFailed?: boolean;

  /**
   * A fixed amount of room round the card for a frame's overhang, instead of exactly what the
   * worn one asks for.
   *
   * <b>For a host where the card sits next to something else that must not move.</b> Every frame
   * hangs a different distance past the card, so a card that reserves exactly the right room is a
   * card that changes size when the frame does — which in a picker means the whole dialog jumps
   * sideways every time somebody clicks a different one. A constant gutter costs a little slack
   * round most frames and lets a very big one draw over it, which nothing here clips.
   *
   * Null asks for exactly what is worn, which is right everywhere the card stands on its own.
   */
  gutter?: number | null;
}>(), {
  profile: null,
  editable: false,
  avatarPreview: null,
  avatarUploadFailed: false,
  gutter: null,
});

/**
 * Mounted beside the card's own contents rather than inside them: a frame is a set of pieces
 * arranged against the card's edges, some of which hang outside it.
 */
const OVERLAY_PRIMITIVES: readonly RenderPrimitive[] = ["frameAssembly"];

/** The room a worn frame asks this card to leave it. Zero when nothing is worn. */
const cosmeticFit = useCosmeticFit(() => props.profile, "profileCard");

/**
 * The same fit, with the overhang pinned where a host has asked for that.
 *
 * Only the outsets are replaced: the insets still say how far the frame reaches over the card's
 * own top, and the edge flags still say which sides it has taken over, and both of those are the
 * frame doing its job rather than the layout reacting to it.
 */
const roomStyle = computed(() => {
  if (props.gutter === null) {
    return cosmeticFit.value.style;
  }

  return {
    ...cosmeticFit.value.style,
    "--cosmetic-outset-top": `${props.gutter}px`,
    "--cosmetic-outset-right": `${props.gutter}px`,
    "--cosmetic-outset-bottom": `${props.gutter}px`,
    "--cosmetic-outset-left": `${props.gutter}px`,
  };
});

defineEmits<{
  clickAvatar: [];
}>();

const currentTheme = persistedValue<string>("appearance.theme", "dark");
const isLightTheme = computed(() => currentTheme.value === "light");

const hasColors = computed(() => props.primaryColor != null || props.accentColor != null);

const statusLabel = computed(() => t("status_online"));

const statusIcon = computed(() => ({ customStatusIconId: props.customStatusIconId, customStatusEmoji: props.customStatusEmoji }));
const hasStatus = computed(() => hasCustomStatus({ ...statusIcon.value, customStatus: props.customStatus }));

const gradientStyle = computed(() => {
  const primary = props.primaryColor ? argbToRgba(props.primaryColor) : "hsl(var(--muted))";
  const accent = props.accentColor ? argbToRgba(props.accentColor) : primary;
  return { background: `linear-gradient(135deg, ${primary}, ${accent})` };
});

const glassTintStyle = computed(() => {
  if (isLightTheme.value) return {};
  if (!props.primaryColor) return {};
  const color = argbToRgba(props.primaryColor);
  return { background: `linear-gradient(180deg, ${color.replace(/[\d.]+\)$/, "0.10)")}, transparent 60%)` };
});

const glassShineTint = computed(() => {
  if (!props.accentColor) return {};
  const accent = argbToRgba(props.accentColor);
  const opacity = isLightTheme.value ? "0.4)" : "0.3)";
  return { background: `linear-gradient(90deg, transparent, ${accent.replace(/[\d.]+\)$/, opacity)}, transparent)` };
});

const cardGlowStyle = computed(() => {
  if (!props.accentColor) return {};
  const accent = argbToRgba(props.accentColor);
  if (isLightTheme.value) {
    const border = accent.replace(/[\d.]+\)$/, "0.3)");
    const shadow = accent.replace(/[\d.]+\)$/, "0.15)");
    return { boxShadow: `0 2px 16px ${shadow}, inset 0 0 0 1px ${border}` };
  }
  const outerGlow = accent.replace(/[\d.]+\)$/, "0.25)");
  const midGlow = accent.replace(/[\d.]+\)$/, "0.12)");
  const innerBorder = accent.replace(/[\d.]+\)$/, "0.2)");
  return { boxShadow: `0 0 24px ${outerGlow}, 0 0 48px ${midGlow}, inset 0 0 0 1px ${innerBorder}` };
});

const avatarRingStyle = computed(() => {
  if (!props.accentColor) return {};
  const accent = argbToRgba(props.accentColor);
  if (isLightTheme.value) {
    const glow = accent.replace(/[\d.]+\)$/, "0.25)");
    return { borderColor: accent, boxShadow: `0 0 6px ${glow}` };
  }
  const glow = accent.replace(/[\d.]+\)$/, "0.4)");
  return { borderColor: accent, boxShadow: `0 0 10px ${glow}` };
});

/** The colour this card would paint the name in, handed to whatever is worn as its fallback. */
const nameAccentColor = computed(() => {
  const accent = props.accentColor;

  if (!accent) {
    return undefined;
  }

  // Darkened for readability on white.
  return argbToRgba(isLightTheme.value ? shadeArgb(accent, 0.3) : accent);
});
</script>

<style scoped>

/*
 * Not clipped, so a frame worn here hangs over the edge exactly as it does on the real card. The
 * rounding moved down to the two things that paint into the corners — see the popover, which made
 * the same move for the same reason.
 */
.preview-card {
  position: relative;
  width: 320px;
  border-radius: 14px;
  overflow: visible;
  background: hsl(var(--card));
  transition: box-shadow 0.3s ease;

  /*
   * The hairline, on every side nothing worn has taken over.
   *
   * A frame is the card's edge rather than something lying on one, and art has gaps in it — so a card
   * that went on drawing its own line put a thin grey rule through every space between the thorns.
   */
  border-style: solid;
  border-color: hsl(var(--border) / 0.5);
  border-width:
    var(--cosmetic-edge-top, 1px)
    var(--cosmetic-edge-right, 1px)
    var(--cosmetic-edge-bottom, 1px)
    var(--cosmetic-edge-left, 1px);
}

/*
 * The room the card is given, so a piece sitting on its top edge does not land on the buttons above.
 *
 * This card is not a popover floating over a page — it sits in a settings column, and the column is
 * ours to arrange while the frame is what somebody chose. So the card moves and the frame does not.
 */
.preview-room {
  width: max-content;
  padding:
    var(--cosmetic-outset-top, 0px)
    var(--cosmetic-outset-right, 0px)
    var(--cosmetic-outset-bottom, 0px)
    var(--cosmetic-outset-left, 0px);
}

/* Full-bleed background */
.preview-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
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

/* Hero spacer */
.preview-spacer {
  position: relative;
  height: calc(90px + var(--cosmetic-inset-top, 0px));
  z-index: 1;
}

/* Glass zone */
.preview-glass-zone {
  position: relative;
  z-index: 2;
  /* Handed down to the body rather than clipped here: the avatar is lifted out of this zone. */
  border-bottom-left-radius: inherit;
  border-bottom-right-radius: inherit;
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
  border-bottom-left-radius: inherit;
  border-bottom-right-radius: inherit;
  padding:
    0
    calc(12px + var(--cosmetic-inset-right, 0px))
    calc(12px + var(--cosmetic-inset-bottom, 0px))
    calc(12px + var(--cosmetic-inset-left, 0px));
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
  border: 2.5px solid hsl(var(--card) / var(--card-alpha));
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

/*
 * As wide as its letters, not the column: a styled name spreads its gradient across its own box.
 * Clip, not hidden, so a worn glow may spill past the box by the room the name style leaves it.
 */
.preview-name {
  align-self: flex-start;
  max-width: 100%;
  font-size: 0.92rem;
  font-weight: 700;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: clip;
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
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 0.7rem;
  color: hsl(var(--foreground) / 0.6);
  font-style: italic;
  margin-bottom: 6px;
}

.preview-custom-status__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* ── Light theme overrides ── */
:root:not(.dark) .preview-card {
  /* The colour only — the widths stay where a worn frame can turn them off. */
  border-color: hsl(var(--border));
  background: hsl(var(--card));
  box-shadow: 0 2px 16px hsl(var(--foreground) / 0.06);
}

:root:not(.dark) .preview-bg-default {
  background: linear-gradient(160deg, hsl(var(--muted)) 0%, hsl(var(--border)) 100%);
}

:root:not(.dark) .preview-frost {
  display: none;
}

:root:not(.dark) .preview-shine {
  display: none;
}

:root:not(.dark) .preview-body {
  background: hsl(var(--card));
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

:root:not(.dark) .preview-avatar {
  border-color: hsl(var(--card));
  box-shadow: 0 2px 8px hsl(var(--foreground) / 0.12);
}

:root:not(.dark) .preview-role-chip {
  background: hsl(var(--muted));
  border-color: hsl(var(--border));
  color: hsl(var(--foreground) / 0.8);
}

:root:not(.dark) .preview-bio {
  background: hsl(var(--muted) / 0.6);
  border-color: hsl(var(--border) / 0.5);
}
</style>
