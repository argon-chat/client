<script lang="ts">
/** The four places a look is ever seen, named so a caller can ask for some of them. */
export type LookSurface = "card" | "avatar" | "message" | "memberRow";

const ALL_SURFACES: readonly LookSurface[] = ["card", "avatar", "message", "memberRow"];
</script>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useElementSize } from "@vueuse/core";
import { useLocale } from "@/store/system/localeStore";
import ProfileCardPreview from "@/components/settings/ProfileCardPreview.vue";
import AvatarStage from "@/cosmetics/preview/stages/AvatarStage.vue";
import MemberRowStage from "@/cosmetics/preview/stages/MemberRowStage.vue";
import MessageStage from "@/cosmetics/preview/stages/MessageStage.vue";
import type { ArgonUserProfile } from "@argon/glue";

/**
 * A look on every surface anybody will ever see it on, in one column.
 *
 * <b>The same four in every dialog, whatever is being chosen.</b> A picker that showed only the
 * surface its own kind lives on answered the wrong question: nobody wears one cosmetic, and the
 * thing people actually want to know before they press Apply is what they will look like — in a
 * profile card, in a member list, at the head of a message, and as a face 22 pixels across. Showing
 * a different set per kind also meant learning a new dialog each time.
 *
 * <b>The card is the real one, not a likeness of it.</b> <c>ProfileCardPreview</c> is the component
 * the settings page draws and the admin console approves rows against, drawn here through a scale
 * and nothing else — so every proportion is the product's own. A second, smaller drawing of it
 * would drift, and the drift would be invisible until somebody complained their frame looked wrong
 * to everyone but them.
 *
 * It takes a profile rather than a list of cosmetics, because that is what all four stages take and
 * because a profile is what the server hands out: a draft is the account's own profile with the
 * loadout's overrides and the draft's rows put over it, which is exactly what a reader receives.
 */
const props = withDefaults(
  defineProps<{
    /** The look as a reader would receive it. Null before the account's own profile has landed. */
    profile: ArgonUserProfile | null;

    displayName: string;
    username: string;
    userId: string;
    avatarFileId: string | null;
    isPremium?: boolean;

    /**
     * Which of the four to draw, in this order. All of them unless the caller says otherwise.
     *
     * <b>For putting them on different sides of the same dialog.</b> Four surfaces in one column
     * is a column as tall as a screen — and the card is the only one of them that is tall, so the
     * sensible thing is to stand it beside the list and stack the three short ones on the far
     * side. The caller decides that, because only the caller knows what room it has.
     */
    surfaces?: readonly LookSurface[];

    /**
     * How wide the column may be.
     *
     * Only the transcript needs telling — the rest are their own size — but it is the widest of
     * them, so left alone it sets the column, and the column it sets comes out of the list.
     */
    width?: number;
  }>(),
  { surfaces: () => ALL_SURFACES, width: 340 },
);

function shows(surface: LookSurface): boolean {
  return props.surfaces.includes(surface);
}

const { t } = useLocale();

const bio = computed(() => props.profile?.bio ?? null);

const primaryColor = computed(() => props.profile?.primaryColor ?? null);

const accentColor = computed(() => props.profile?.accentColor ?? null);

/**
 * How much room round the card is kept for a frame's overhang, whatever frame is on.
 *
 * Wide enough for most of them; a bigger one draws over the slack rather than pushing the column
 * out, which is the whole point — a preview that changes size as you click through a list makes
 * the list itself move under the pointer.
 */
const FRAME_GUTTER = 44;

const cardBox = ref<HTMLElement | null>(null);

const { height: cardHeight } = useElementSize(cardBox);

/**
 * The tallest the card has been while this preview has been open, which is the room it keeps.
 *
 * <b>The gutter settles the width; this settles what is left of the height.</b> A frame also lies
 * over the card's own top, and the card answers by pushing its contents down — honest, and worth
 * seeing, but it means the card is a different height per frame. Reserving the high-water mark
 * lets a shorter one sit in the same box instead of dragging everything below it upwards.
 */
const tallest = ref(0);

watch(cardHeight, height => {
  if (height > tallest.value) tallest.value = height;
});

const cardRoom = computed(() => (tallest.value > 0 ? { minHeight: `${tallest.value}px` } : {}));

</script>

<template>
  <div class="look">
    <!--
      The card first, because it is the surface people picture when they think about what they are
      wearing. Everything under it is where that same look actually gets seen.
    -->
    <section v-if="shows('card')" class="look-slot">
      <h4 class="look-title">{{ t("cosmetic_surface_card") }}</h4>
      <div class="look-card-room" :style="cardRoom">
        <div ref="cardBox">
          <ProfileCardPreview
            :gutter="FRAME_GUTTER"
            :profile="profile"
            :display-name="displayName"
            :username="username"
            :user-id="userId"
            :avatar-file-id="avatarFileId"
            :bio="bio"
            :is-premium="isPremium === true"
            :primary-color="primaryColor"
            :accent-color="accentColor"
            :background-id="null"
          />
        </div>
      </div>
    </section>

    <section v-if="shows('avatar')" class="look-slot">
      <h4 class="look-title">{{ t("cosmetic_surface_avatar") }}</h4>
      <AvatarStage
        compact
        :profile="profile"
        :display-name="displayName"
        :avatar-file-id="avatarFileId"
        :user-id="userId"
      />
    </section>

    <section v-if="shows('message')" class="look-slot">
      <h4 class="look-title">{{ t("cosmetic_surface_message") }}</h4>
      <MessageStage
        :profile="profile"
        :display-name="displayName"
        :avatar-file-id="avatarFileId"
        :user-id="userId"
        :width="width"
      />
    </section>

    <section v-if="shows('memberRow')" class="look-slot">
      <h4 class="look-title">{{ t("cosmetic_surface_member_row") }}</h4>
      <MemberRowStage
        :profile="profile"
        :display-name="displayName"
        :avatar-file-id="avatarFileId"
        :user-id="userId"
      />
    </section>
  </div>
</template>

<style scoped>
/* Unclipped: a frame draws outside the card it decorates and must not be cut here of all places. */
.look {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: flex-start;
}

/* Unclipped, so a frame wider than the gutter still draws all of itself. */
.look-card-room {
  display: flex;
  justify-content: center;
  width: 100%;
}

.look-slot {
  display: flex;
  flex-direction: column;
  gap: 5px;
  align-items: flex-start;
  max-width: 100%;
}

/*
 * Named, because four pictures of the same person in a column is a puzzle otherwise — the point of
 * each is which place it stands for, and that is the one thing a picture cannot say about itself.
 */
.look-title {
  margin: 0;

  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground) / 0.8);
}
</style>
