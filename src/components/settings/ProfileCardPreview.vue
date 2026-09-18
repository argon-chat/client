<template>
  <!--
    Room around the card for whatever a worn frame hangs outside it.

    A wrapper with padding rather than a margin on the card itself, and that is not a stylistic
    preference: this sits inside a `space-y-*` container, whose `> * + *` rule is more specific than
    any scoped class here and had been quietly winning. A padding is nobody else's property.
  -->
  <div class="preview-room" :style="roomStyle">
  <div class="preview-card" :style="[cardGlowStyle, cardMap]">
    <!--
      Full-bleed background. A worn cosmetic wins over the bundled clip the picker below offers,
      the same order the real card uses — a preview that disagreed with the card would be worse
      than none.
    -->
    <div class="preview-bg">
      <CosmeticSurface
        v-if="hasCosmeticBackground"
        surface="profileCard"
        :profile="profile"
        :primitives="BACKGROUND_PRIMITIVES"
        :tint-color="primaryColor"
      />
      <video
        v-else-if="bgSrc"
        :src="bgSrc"
        autoplay
        loop
        muted
        playsinline
        class="preview-bg-media"
      />
      <div v-else-if="hasColors" class="preview-bg-media" :style="gradientStyle" />
      <div v-else class="preview-bg-media preview-bg-default" />
      <div v-if="!hasCosmeticBackground && bgSrc && primaryTintStyle" class="preview-bg-tint" :style="primaryTintStyle" />
    </div>

    <!--
      Over everything on the card: the frame around it and whatever moves across it. Outside the
      background wrapper on purpose — that one is under the card's own contents, and these are the
      two kinds whose whole point is that they are not.
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
              <!-- Premium is one of the badges this renders, so the lone diamond above went with it. -->
              <CosmeticBadges :profile="profile" :flags="isPremium ? UserFlag.PREMIUM : 0" />
            </div>
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

        <!--
          The board, here for the same reason the rest of this card is: somebody arranging their
          cards a few centimetres below should be looking at what everybody else will see, not at a
          second drawing of it.
        -->
        <CosmeticBoard class="preview-board" :profile="profile" />
      </div>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { CameraIcon, Loader2, X } from "lucide-vue-next";
import { UserFlag, type ArgonUserProfile } from "@argon/glue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import CosmeticBadges from "@/cosmetics/CosmeticBadges.vue";
import CosmeticNickname from "@/cosmetics/CosmeticNickname.vue";
import CosmeticBoard from "@/cosmetics/CosmeticBoard.vue";
import CosmeticSurface from "@/cosmetics/CosmeticSurface.vue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { useCosmeticFit } from "@/composables/useCosmeticFit";
import { useCardMap, SETTINGS_CARD } from "@/composables/useCardMap";
import { argbToRgba, getBackgroundSrc, shadeArgb } from "@/lib/profileCustomization";
import { useLocale } from "@/store/system/localeStore";
import { persistedValue } from "@argon/storage";

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

  /**
   * What is actually being worn, for the parts of the card that are cosmetics rather than settings.
   *
   * The saved profile rather than a speculative one: equipping goes through the server, which
   * broadcasts, which refreshes this. So the preview shows what other people would see, which is the
   * only thing it is for.
   */
  profile?: ArgonUserProfile | null;

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

const cosmetics = useCosmeticsStore();

const BACKGROUND_PRIMITIVES = ["videoLayer", "imageLayer", "spriteSheet"] as const;

/**
 * Mounted beside the card's own contents rather than inside them, which is what makes them
 * different kinds.
 *
 * Three of them: a frame is a set of pieces arranged against the card's edges, some of which hang
 * outside it; an effect is one picture laid across the whole thing; a scene is a list of moving
 * things that puts its own boxes at whichever depths its row named.
 */
const OVERLAY_PRIMITIVES = ["frameAssembly", "cardLayer", "sceneStage"] as const;

/** The room a worn frame asks this card to leave it. Zero when nothing is worn. */
const cosmeticFit = useCosmeticFit(() => props.profile, "profileCard");

/**
 * Where this card's own parts are, for the things drawn on top of it.
 *
 * Its own numbers rather than the popover's: this card is 320px wide with a 65px avatar in a
 * different place, and handing a scene the popover's measurements would put its face-shaped hole a
 * centimetre from the face.
 */
const cardMap = useCardMap(() => props.profile, "profileCard", SETTINGS_CARD);

/**
 * The same fit, with the overhang pinned where a host has asked for that.
 *
 * Only the outsets are replaced: the insets still say how far the frame reaches over the card's
 * own top, and the edge flags still say which sides it has taken over, and both of those are the
 * frame doing its job rather than the layout reacting to it.
 */
const roomStyle = computed(() => {
  if (props.gutter === null) return cosmeticFit.value.style;

  return {
    ...cosmeticFit.value.style,
    "--cosmetic-outset-top": `${props.gutter}px`,
    "--cosmetic-outset-right": `${props.gutter}px`,
    "--cosmetic-outset-bottom": `${props.gutter}px`,
    "--cosmetic-outset-left": `${props.gutter}px`,
  };
});

const hasCosmeticBackground = computed(() =>
  cosmetics
    .resolve(props.profile, "profileCard")
    .some(item => (BACKGROUND_PRIMITIVES as readonly string[]).includes(item.kind.primitive)),
);

defineEmits<{
  clickAvatar: [];
}>();

const currentTheme = persistedValue<string>("appearance.theme", "dark");
const isLightTheme = computed(() => currentTheme.value === "light");

const bgSrc = computed(() => getBackgroundSrc(props.backgroundId));
const hasColors = computed(() => props.primaryColor != null || props.accentColor != null);

const statusLabel = computed(() => t("status_online"));

const gradientStyle = computed(() => {
  const primary = props.primaryColor ? argbToRgba(props.primaryColor) : "hsl(var(--muted))";
  const accent = props.accentColor ? argbToRgba(props.accentColor) : primary;
  return { background: `linear-gradient(135deg, ${primary}, ${accent})` };
});

const primaryTintStyle = computed(() => {
  if (!props.primaryColor) return null;
  const color = argbToRgba(props.primaryColor);
  const opacity = isLightTheme.value ? "0.12)" : "0.2)";
  return { background: color.replace(/[\d.]+\)$/, opacity) };
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

  if (!accent) return undefined;

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

.preview-bg-tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
  mix-blend-mode: overlay;
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
  border-bottom-left-radius: inherit;
  border-bottom-right-radius: inherit;
  overflow: hidden;
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

.preview-board {
  margin-top: 8px;
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
