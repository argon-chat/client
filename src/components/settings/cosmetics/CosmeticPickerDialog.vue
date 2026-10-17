<script setup lang="ts">
import {
  computed,
  ref,
  watch,
} from "vue";
import {
  IconCheck,
  IconClock,
  IconLock,
  IconSparkles,
} from "@tabler/icons-vue";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@argon/ui/dialog";
import type {
  ArgonUserProfile,
  CatalogueCosmetic,
} from "@argon/glue";
import { storeToRefs } from "pinia";
import { Button } from "@argon/ui/button";

import {
  availableUntilOf,
  lockReasonOf,
  lockedAccessibleName,
} from "@/components/settings/cosmetics/cosmeticLock";
import {
  emptyNicknameDraft,
  isNicknameDraftAimable,
  nicknameChange,
  nicknameDraftOf,
  sameNicknameDraft,
  type NicknameDraft,
} from "@/components/settings/cosmetics/nicknameDraft";
import {
  focusRadioAt,
  radioStepTarget,
} from "@/components/settings/cosmetics/rovingRadio";
import {
  itemChange,
  unequipChange,
  wornAfter,
  type WardrobeChange,
} from "@/components/settings/cosmetics/wardrobeChange";
import {
  documentLanguage,
  useLocale,
} from "@/store/system/localeStore";
import type { CosmeticKindModule } from "@/cosmetics/types";
import type { NicknameAxes } from "@/cosmetics/wire";
import type { NicknameStyleTuning } from "@/cosmetics/kinds/nickname-style";
import CosmeticCell from "@/components/settings/cosmetics/CosmeticCell.vue";
import CosmeticLookPreview, { type LookSurface } from "@/cosmetics/CosmeticLookPreview.vue";
import NicknameAxesPicker from "@/components/settings/cosmetics/NicknameAxes.vue";
import NicknameTuning from "@/cosmetics/tuning/NicknameTuning.vue";
import { asWornItem } from "@/cosmetics/wornEntry";
import { cosmeticIdKey } from "@/cosmetics/resolver";
import { cosmeticName } from "@/lib/cosmeticText";
import { leadingGraphemes } from "@/cosmetics/preview/leadingGraphemes";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { useEscapeDismiss } from "@/lib/modalLayers";
import { useMe } from "@/store/auth/meStore";

/**
 * Choosing what to wear on one kind, with room to see it.
 *
 * <b>Everything here is a draft until it is applied.</b> The first cut wrote every click straight to
 * the server, so the profile behind the dialog changed while somebody was still looking through the
 * options — and the button at the bottom did nothing, because there was nothing left for it to do.
 * The dialog now holds its own copy, the preview draws that copy, and closing without applying
 * leaves the profile exactly as it was found.
 */
const props = withDefaults(defineProps<{
  open: boolean;
  kind: CosmeticKindModule;
  profile: ArgonUserProfile | null;
  items: CatalogueCosmetic[];
  busy: boolean;
  canUpsell?: boolean;
}>(), {
  canUpsell: false,
});

const emit = defineEmits<{
  "update:open": [value: boolean];
  apply: [change: WardrobeChange];
  upsell: [];
}>();

const localeStore = useLocale();
const { t } = localeStore;
const { currentLocale } = storeToRefs(localeStore);
const me = useMe();
const cosmetics = useCosmeticsStore();

const nameOf = (item: CatalogueCosmetic) => cosmeticName(item, currentLocale.value);

const wearable = (item: CatalogueCosmetic) => cosmetics.mayWear(item);

/**
 * A kind with nothing to choose between.
 *
 * Everything it looks like comes from its axes and its wearer's own settings, so there is no grid:
 * the dialog opens on the constructor. Two rows used to sit here and they were the same offer twice
 * — whichever you picked, the axes and the tuning said it after.
 */
const bare = computed(() => props.kind.bare === true);

/**
 * What shape the tiles in the list are, decided by what is being chosen rather than by which kind.
 *
 * <b>The previews beside the list are the same in every one of these dialogs</b> — that is the
 * whole point of them — but a tile still has to be the shape of the thing on it, and one grid of
 * small squares answered every kind the same way and answered none of them well: a frame in a
 * 64px box is a dark square.
 *
 * <ul>
 *   <li><b>tall</b> — a frame surrounds a profile card, and a card is upright. In a square it is
 *       four bands of equal weight, which is the one thing a frame never is.</li>
 *   <li><b>compact</b> — a decoration: no card to be judged on, so the tile is the thing itself,
 *       drawn as large as the tile allows.</li>
 * </ul>
 *
 * Keyed on the primitive rather than the kind key, so a kind added to the build lands in the right
 * shape because of what it draws.
 */
type PickerShape = "tall" | "compact";

const shape = computed<PickerShape>(() => {
  switch (props.kind.primitive) {
    case "frameAssembly": return "tall";
    default: return "compact";
  }
});

/** What is worn on this kind right now. */
const current = computed(() => cosmetics.wornOfKind(props.profile, props.kind.key));

/** Whether a bare kind is on at all, which is the one thing its row still records. */
const bareWorn = computed(() => current.value !== null);

/** The catalogue row worn on this kind, if it is one. */
const wornItemId = computed(() => asWornItem(current.value)?.itemId ?? null);

/**
 * Whether an axis row the worn look names can still be offered.
 *
 * A row the catalogue dropped, moved to another kind or had switched off is left out of the draft,
 * so the next Apply does not send it back. Nothing is judged before the catalogue has arrived.
 */
function axisOffered(axis: keyof NicknameAxes, optionId: string): boolean {
  if (cosmetics.catalogue === null) {
    return true;
  }

  const facet = props.kind.facets?.find(candidate => candidate.id === axis);
  const row = cosmetics.itemById(optionId);

  if (facet === undefined || row === null) {
    return false;
  }

  return row.kindKey === facet.optionKindKey && cosmetics.isKindEnabled(row.kindKey);
}

/** What the wearer has already decided about a bare kind: its axes and their own settings. */
const wornNickname = computed(() => nicknameDraftOf(current.value, axisOffered));

const picked = ref<string | null>(null);
const nickname = ref<NicknameDraft>(emptyNicknameDraft());

/** Opening starts from what is worn, never from a draft somebody walked away from. */
watch(() => [props.open, props.kind.key] as const, ([open]) => {
  if (!open) {
    return;
  }

  picked.value = wornItemId.value;
  nickname.value = wornNickname.value;

  // A grant can start or lapse while the dialog is shut; what may be worn is asked again each time.
  void cosmetics.loadOwned({ force: true });
}, { immediate: true });

function sameId(left: string | null, right: string | null): boolean {
  const leftKey = left === null ? null : cosmeticIdKey(left);
  const rightKey = right === null ? null : cosmeticIdKey(right);

  return leftKey === rightKey;
}

// The look can change under an open dialog — another tab, another device. An untouched draft follows it.
watch(wornItemId, (worn, wornBefore) => {
  if (props.open && sameId(picked.value, wornBefore)) {
    picked.value = worn;
  }
});

watch(wornNickname, (worn, wornBefore) => {
  if (props.open && sameNicknameDraft(nickname.value, wornBefore)) {
    nickname.value = worn;
  }
});

/** Whether the axes and the tuning have anything to act on: something chosen, or a bare kind. */
const configuring = computed(() => bare.value || picked.value !== null);

/** What Apply would ask the server for. */
const change = computed<WardrobeChange>(() => (bare.value
  ? nicknameChange(nickname.value, props.kind.key)
  : itemChange(props.kind.key, picked.value)));

const dirty = computed(() => (bare.value
  ? !sameNicknameDraft(nickname.value, wornNickname.value)
  : !sameId(picked.value, wornItemId.value)));

function requestOpen(open: boolean): void {
  if (!open && props.busy) {
    return;
  }

  emit("update:open", open);
}

useEscapeDismiss(() => props.open, () => requestOpen(false));

function itemById(itemId: string | null): CatalogueCosmetic | null {
  return cosmetics.itemById(itemId);
}

/** Whether an item is the one in the draft. */
function isPicked(itemId: string): boolean {
  return picked.value !== null && sameId(picked.value, itemId);
}

/** Puts an item on, replacing what is there, or clears the draft. */
function toggle(item: CatalogueCosmetic | null): void {
  picked.value = item === null ? null : item.cosmeticId;
}

const axes = computed(() => (props.kind.facets ?? []).filter(facet => cosmetics.isKindEnabled(facet.optionKindKey)));

/** The rest of the look: everything worn that this dialog is not about. */
const rest = computed(() => (props.profile?.cosmetics ?? []).filter(entry => entry !== current.value));

/**
 * The whole look, with this kind's entry replaced by the draft.
 *
 * <b>On top of the rest of it, not on a blank card.</b> The question being answered is "how does
 * this go with the rest", and it cannot be answered by a stage with nothing else on it.
 */
const draft = computed(() => {
  const after = wornAfter(change.value);

  return after === null ? rest.value : [...rest.value, after];
});

/**
 * The draft as a reader would receive it: the account's profile with this look on it.
 *
 * <b>A profile rather than a list, because that is what the real card takes.</b> The preview column
 * draws the same component a member of the space draws, and that component reads a profile — so
 * the honest way to show an unsaved draft is to build the profile the server would have sent, and
 * hand it over. Nothing about the draft is special-cased downstream, which is the whole point.
 */
const previewProfile = computed<ArgonUserProfile | null>(() => {
  const base = props.profile;

  if (!base) {
    return null;
  }

  return { ...base, cosmetics: draft.value };
});

/**
 * The card stands beside the list and the three short ones stack on the far side of it.
 *
 * Which is what keeps the dialog shorter than a screen: a profile card is most of six hundred
 * pixels by itself, and three more surfaces under it were another five.
 */
const CARD_ONLY: readonly LookSurface[] = ["card"];

const THE_SHORT_ONES: readonly LookSurface[] = ["avatar", "message", "memberRow"];

/**
 * How much of the dialog the far column may have.
 *
 * Narrower than the transcript would take on its own, because every pixel it takes is one the
 * list does not.
 */
const SHORT_COLUMN_WIDTH = 268;

interface Box { width: number; height: number }

/**
 * The room one tile's picture gets.
 *
 * Literals that this file's own grid has to agree with: the grid's `minmax` floor less the 4px of
 * padding on each side. The real tile is a few pixels wider, and telling the difference is not
 * worth a resize observer behind every tile in a scrolling list.
 */
const ART_BOXES: Record<PickerShape, Box> = {
  tall: { width: 187, height: 248 },
  compact: { width: 187, height: 168 },
};

const artBox = computed<Box>(() => ART_BOXES[shape.value]);

/**
 * Whether the chosen tile is marked by a dot on its label rather than by a ring round it.
 *
 * True wherever the tile is a picture: a ring drawn round a frame is a second frame, in the
 * accent colour, on the outside of the thing whose entire job is to be the outside of a card.
 */
const litByDot = computed(() => shape.value === "tall");

/**
 * The tile's picture box, sized from the script rather than from a second copy in the stylesheet.
 *
 * The height has to be here and it has to be a minimum as well: everything drawn inside is
 * positioned absolutely, so the box has no content of its own to be measured by. Without a floor
 * the grid read the picture as taking no room, gave its rows an equal share of the list's maximum
 * height and squashed every frame to a third of itself.
 */
const artStyle = computed(() => ({
  height: `${artBox.value.height}px`,
  minHeight: `${artBox.value.height}px`,
}));

const sample = computed(() => me.me?.displayName || "Argon");

/** The account's own picture: a frame is chosen against the face it will sit on. */
const face = computed(() => me.me?.avatarFileId ?? undefined);

function setAxes(chosen: NicknameAxes): void {
  nickname.value = { ...nickname.value, axes: chosen };
}

function setTuning(tuning: NicknameStyleTuning): void {
  nickname.value = { ...nickname.value, tuning };
}

const aimable = computed(() => isNicknameDraftAimable(nickname.value));

/** Every catalogue row the draft would put on: the chosen tile, or the chosen axis rows. */
const draftRows = computed<CatalogueCosmetic[]>(() => {
  const ids = bare.value
    ? [nickname.value.axes.font, nickname.value.axes.effect]
    : [picked.value];

  const rows: CatalogueCosmetic[] = [];

  for (const id of ids) {
    const row = itemById(id);

    if (row !== null) {
      rows.push(row);
    }
  }

  return rows;
});

/** A row in the draft this account may not wear, which the server would refuse. */
const lockedPick = computed(() => draftRows.value.find(row => !wearable(row)) ?? null);

const hovered = ref<CatalogueCosmetic | null>(null);

/**
 * What the caption is about: a locked row in the draft first, since it is why Apply is off; else
 * whatever the pointer is over, else the thing put on.
 */
const subject = computed(() => {
  if (lockedPick.value !== null) {
    return lockedPick.value;
  }

  if (bare.value) {
    return null;
  }

  return hovered.value ?? itemById(picked.value);
});

const lock = computed(() => {
  const item = subject.value;

  if (!item) {
    return null;
  }

  const reason = lockReasonOf(item, wearable(item));

  if (reason === "ultima") {
    return { icon: IconSparkles, key: "cosmetic_locked_ultima", upsell: props.canUpsell };
  }

  if (reason === "granted") {
    return { icon: IconLock, key: "cosmetic_locked_grant", upsell: false };
  }

  return null;
});

/** Until when the thing under the caption is offered at all, for a row that is not always there. */
const until = computed(() => {
  const date = subject.value === null ? null : availableUntilOf(subject.value);

  if (date === null) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat(documentLanguage(currentLocale.value), { dateStyle: "medium" }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
});

const canApply = computed(() => !props.busy && dirty.value && lockedPick.value === null);

function apply(): void {
  if (!canApply.value) {
    return;
  }

  emit("apply", change.value);
}

/**
 * Taking this kind off.
 *
 * <b>A button rather than an empty tile in the grid.</b> The tile was a cosmetic-shaped hole
 * among the cosmetics — it had a name strip saying "None", a selected ring of its own and a
 * picture of nothing — and a kind with no grid at all could never have one, so half the dialogs
 * said "take it off" one way and half the other.
 *
 * A kind with tiles clears its draft and leaves the rest to Apply, which is how every other click
 * in this dialog behaves. A bare kind has no draft to clear — being worn at all is the only thing
 * its row records — so for that one, taking it off <i>is</i> the change, and it is written.
 */
function clear(): void {
  if (!bare.value) {
    toggle(null);
    return;
  }

  emit("apply", unequipChange(props.kind.key));
}

/** Whether there is anything to take off: something in the draft, or a bare kind that is on. */
const wearing = computed(() => (bare.value ? bareWorn.value : picked.value !== null));

/** The tiles that can be chosen, in the order the grid draws them: what the arrow keys walk. */
const choosable = computed(() => props.items.filter(item => wearable(item)));

/** The one tile Tab reaches: the chosen one, or the first that can be chosen while none is. */
const tabStopId = computed(() => {
  const chosen = choosable.value.find(item => isPicked(item.cosmeticId));

  return (chosen ?? choosable.value[0])?.cosmeticId ?? null;
});

function step(event: KeyboardEvent, item: CatalogueCosmetic): void {
  const from = choosable.value.indexOf(item);
  const target = radioStepTarget(event, from, choosable.value.length);

  if (target === null) {
    return;
  }

  event.preventDefault();

  const next = choosable.value[target];

  toggle(next);

  if (event.currentTarget instanceof Element) {
    focusRadioAt(event.currentTarget, props.items.indexOf(next));
  }
}

function upsell(): void {
  emit("upsell");
}
</script>

<template>
  <!--
    Width as utility classes rather than a scoped rule. DialogContent carries its own
    `w-full max-w-lg` and teleports into a portal, so a scoped class never picks up the scope
    attribute and loses the tie on order — the dialog came out the width of the screen.
  -->
  <Dialog :open="open" @update:open="requestOpen">
    <DialogContent class="cosmetic-picker w-[1180px] max-w-[94vw] overflow-x-clip overflow-y-auto" max-height="92vh">
      <DialogHeader>
        <DialogTitle>{{ t(kind.labelKey) }}</DialogTitle>
      </DialogHeader>

      <div class="picker-body" :class="[`picker-body--${shape}`, `picker-body--${kind.primitive}`]">
        <!--
          The same four surfaces in every one of these dialogs, whatever is being chosen — but on
          two sides of it rather than in one column. The card is the only tall one of the four, so
          stacking the other three under it made a dialog taller than most windows while the list
          it is meant to help with sat in a corner of it.
        -->
        <CosmeticLookPreview
          :profile="previewProfile"
          :display-name="sample"
          :username="me.me?.username ?? ''"
          :user-id="me.me?.userId ?? ''"
          :avatar-file-id="face ?? null"
          :is-premium="me.isPremium"
          :surfaces="CARD_ONLY"
        />

        <div class="picker-choices">
        <div
          v-if="!bare"
          class="picker-grid"
          role="radiogroup"
          :aria-label="t(kind.labelKey)"
        >
          <button
            v-for="item in items"
            :key="item.cosmeticId"
            type="button"
            role="radio"
            class="picker-cell"
            :class="{ 'picker-cell--active': isPicked(item.cosmeticId), 'picker-cell--locked': !wearable(item) }"
            :aria-checked="isPicked(item.cosmeticId)"
            :aria-label="lockedAccessibleName(nameOf(item), wearable(item), t('cosmetic_locked'))"
            :tabindex="item.cosmeticId === tabStopId ? 0 : -1"
            :title="nameOf(item)"
            :disabled="busy || !wearable(item)"
            @click="toggle(item)"
            @keydown="step($event, item)"
            @mouseenter="hovered = item"
            @mouseleave="hovered = null"
          >
            <span class="picker-art" :style="artStyle">
              <CosmeticCell
                :item="item"
                :width="artBox.width"
                :height="artBox.height"
                :sample="leadingGraphemes(sample, 8)"
                :avatar-user-id="me.me?.userId"
                :avatar-file-id="face"
              />
            </span>

            <!--
              What is true about this one, said on the tile's own strip rather than over the
              picture. A tick or a padlock printed on top of a frame is printed on the thing being
              judged — and the strip has room for the name as well.
            -->
            <span class="picker-tag">
              <template v-if="isPicked(item.cosmeticId)">
                <span v-if="litByDot" class="picker-dot" />
                <IconCheck v-else class="picker-tick w-3 h-3" />
              </template>
              <IconLock v-else-if="!wearable(item)" class="picker-shut w-3 h-3" />

              <span class="picker-tag-name">{{ nameOf(item) }}</span>
            </span>
          </button>
        </div>

        <!--
          How the thing under the pointer is come by, and nothing else. It used to name it too,
          which was the same word the tile itself already carries an inch above — the only reason
          anybody looked down here was to find out why something had a padlock on it.
        -->
        <div v-if="!bare || lock" class="picker-caption">
          <div v-if="lock" class="picker-lock-note">
            <component :is="lock.icon" class="w-3 h-3" />
            <span>{{ t(lock.key) }}</span>
            <button v-if="lock.upsell" type="button" class="picker-upsell" @click="upsell">
              {{ t("ultima_get") }}
            </button>
          </div>

          <div v-if="until" class="picker-lock-note">
            <IconClock class="w-3 h-3" />
            <span>{{ t("cosmetic_available_until", { date: until }) }}</span>
          </div>
        </div>

        <!--
          The axes of whatever is on. They belong to the thing being chosen, so they live beside
          the list and not under the whole dialog, and they read from the draft like everything
          else here.
        -->
        <div v-if="configuring && axes.length > 0" class="picker-axes">
          <NicknameAxesPicker
            :kind="kind"
            :axes="nickname.axes"
            :tuning="nickname.tuning"
            :wearable="wearable"
            :sample="sample"
            :disabled="busy"
            @update:axes="setAxes"
          />
        </div>

        <!--
          The part of this that is nobody else's to decide. Only shown once something is on,
          because there is nothing to tune about an empty slot.
        -->
        <NicknameTuning
          v-if="bare && configuring"
          :tuning="nickname.tuning"
          :aimable="aimable"
          :disabled="busy"
          @update:tuning="setTuning"
        />
        </div>

        <CosmeticLookPreview
          :profile="previewProfile"
          :display-name="sample"
          :username="me.me?.username ?? ''"
          :user-id="me.me?.userId ?? ''"
          :avatar-file-id="face ?? null"
          :is-premium="me.isPremium"
          :surfaces="THE_SHORT_ONES"
          :width="SHORT_COLUMN_WIDTH"
        />
      </div>

      <div class="picker-actions">
        <Button v-if="wearing" size="sm" variant="ghost" class="mr-auto text-destructive"
          :disabled="busy" @click="clear">
          {{ t("cosmetic_clear") }}
        </Button>

        <Button size="sm" variant="ghost" :disabled="busy" @click="requestOpen(false)">
          {{ t("cancel") }}
        </Button>
        <Button size="sm" :disabled="!canApply" @click="apply">{{ t("apply") }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
/*
 * The card, then the list, then the three short surfaces: three tracks across rather than two.
 *
 * <b>Sideways is the direction there is room in.</b> Everything stacked in one column made a
 * dialog nine hundred pixels tall with a list the size of a postage stamp in the corner of it —
 * on a screen that is wider than it is tall, and next to a list that is the reason anybody opened
 * this. The outer tracks take whatever the previews are; the list takes what is left, which is
 * now the largest part of the dialog rather than the smallest.
 */
.picker-body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 20px;

  /*
   * Stretched rather than started, which is what lets the list be as tall as the card beside it.
   * With a fixed cap it stopped at five hundred pixels and put a scrollbar on itself while half
   * the dialog sat empty underneath.
   */
  align-items: stretch;
}

/*
 * Two tracks where there is not room for three: the short surfaces go back under the card and the
 * list keeps the rest.
 *
 * Measured against the window rather than the dialog, which is a proxy — but the dialog is capped
 * at 94% of the window, so the two only disagree at the margin. Without this the middle track is
 * what gives, and the list going narrow is the opposite of the point.
 */
@media (max-width: 1040px) {
  .picker-body {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .picker-choices {
    grid-row: 1 / span 2;
    grid-column: 2;
  }
}

/* The list, whatever is under it, and the settings for what is on — one column of decisions. */
.picker-choices {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}

/*
 * Two to a row, and a tile big enough to be looked at rather than identified.
 *
 * One floor for every kind: what differs between a frame and a background is the picture inside
 * the tile, not how many tiles fit across, and three rules saying the same number was three
 * places to forget. Low enough that two still fit after the card beside it took its gutter —
 * at two hundred they fell back to one a row, four pixels short.
 *
 * It grows into whatever the column has — which is however tall the profile card beside it turned
 * out — and only scrolls once the tiles genuinely need more than that.
 *
 * <b>A basis of zero, not of its contents.</b> Measured by its contents it stopped filling the
 * column and started deciding it: forty tiles made the dialog nine hundred pixels tall instead of
 * scrolling inside the height the card had already set. At zero it asks for nothing, the floor
 * below is what it is worth on its own, and everything past that is room the column had spare.
 */
.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(185px, 1fr));
  gap: 10px;
  align-content: start;
  flex: 1 1 0;
  min-height: 420px;
  max-height: 620px;
  padding-right: 8px;

  /*
   * Down only.
   *
   * <b>A scroll container has two axes whether it wants them or not.</b> Asking for <c>auto</c>
   * on one and leaving the other <c>visible</c> is not a thing CSS allows: the visible one
   * computes to <c>auto</c> as well, so the moment a tile let a decoration bleed past its edge —
   * which tiles are deliberately allowed to do — the list grew a horizontal bar along the bottom
   * for a list that only ever goes down. <c>clip</c> is the one value that takes an axis out of
   * the scrolling without dragging the other one in with it.
   */
  overflow-x: clip;
  overflow-y: auto;
}

/*
 * The app's own scrollbar rather than the platform's.
 *
 * `scrollbar-width: thin` still leaves a grey trough the width of a thumbnail's margin down the
 * side of the list, which in a dialog this size is a piece of the operating system sitting in the
 * middle of the artwork. The same 6px rule the message list uses: transparent until the pointer is
 * in the list, and only as loud as it needs to be to be grabbed.
 */
.picker-grid::-webkit-scrollbar {
  width: 6px;
}

.picker-grid::-webkit-scrollbar-track {
  background: transparent;
}

.picker-grid::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.08);
  border-radius: 3px;
}

.picker-grid:hover::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.16);
}

.picker-grid::-webkit-scrollbar-thumb:hover {
  background-color: hsl(var(--foreground) / 0.28);
}

/*
 * A picture with a strip under it, rather than a picture with things printed on it.
 *
 * The padding is load-bearing: it is the gap that lets the chosen tile be outlined without the
 * outline landing on the artwork. Drawn against a frame, a line round the edge of the tile reads
 * as part of the frame — which is exactly the thing being chosen.
 */
.picker-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--secondary) / 0.4);
  text-align: center;
  transition: border-color 0.14s ease, background 0.14s ease;

  /*
   * Not clipped, and that is what makes the tile the size of what is in it.
   *
   * A box that clips is allowed to be smaller than its contents, so the grid was told each tile
   * could be any height at all — and, having a ceiling of its own, it gave the rows an equal
   * share of that ceiling and let every picture overflow into the tile below. Unclipped, the tile
   * has to be as tall as the picture and the strip, and a list too long for its box scrolls.
   * A frame draws outside what it decorates in any case, so there was nothing here to clip.
   */
  overflow: visible;
}

/*
 * Only where nothing else has spoken for the edge.
 *
 * Unqualified, this rule outweighed the chosen tile's — `:not()` and `:hover` are two more
 * classes' worth of specificity than one class — so putting the pointer on the tile you had
 * already picked took the colour back off its border and left half a ring behind.
 */
.picker-cell:not(.picker-cell--active):not(:disabled):hover {
  border-color: hsl(var(--border));
  background: hsl(var(--secondary) / 0.7);
}

/*
 * Inside the border box, not outside it.
 *
 * An outer ring is drawn beyond the tile's own edge, and this grid scrolls — so on the left-hand
 * column the ring was clipped away at the scroller's edge and the chosen tile came out with three
 * sides. Inset, there is nothing outside the box to lose.
 */
.picker-cell--active {
  border-color: hsl(var(--primary));
  box-shadow: inset 0 0 0 1px hsl(var(--primary));
  background: hsl(var(--primary) / 0.12);
}

/*
 * Where the tile is a picture, the chosen one says so on its label and nowhere else.
 *
 * A ring is a fine way to mark a small mark. Round a frame it is a second frame — a blue one,
 * in the accent colour, on the outside of the thing whose whole job is to be the outside of a
 * card. So for a picture the ring, the tint and the coloured border all go, and what is left is
 * a lit dot and the name in full strength.
 */
.picker-body--tall .picker-cell--active {
  border-color: hsl(var(--border) / 0.5);
  box-shadow: none;
  background: hsl(var(--secondary) / 0.4);
}

.picker-body--tall .picker-cell--active .picker-tag {
  color: hsl(var(--foreground));
  font-weight: 600;
}

.picker-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #4ade80;
  box-shadow: 0 0 7px hsl(142 71% 45% / 0.8);
}

/* The picture dims; the name does not, because it is what says why the tile is out of reach. */
.picker-cell--locked .picker-art {
  opacity: 0.45;
}

.picker-cell--locked {
  opacity: 0.75;
}

/*
 * The picture's own box, and the thing a frame's overhang is measured against.
 *
 * Separate from the tile because an absolutely positioned child is laid out against the padding
 * box of whatever is positioned above it — padding on the tile would not have moved it an inch.
 *
 * <b>A height in pixels, and the same number again as a minimum.</b> Everything drawn in here is
 * positioned absolutely, so the box has no content of its own to be measured by — and a row of the
 * grid is sized between what its tiles must have and what they would like. Must-have came out as
 * nothing, so the three rows of frames simply shared the list's maximum height between them and
 * squashed every picture to a third of it. The minimum is what tells the row the picture is not
 * optional; the list scrolls instead, which is what a list too long for its box is supposed to do.
 */
.picker-art {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 100%;
  border-radius: 7px;
}

/*
 * A decoration is a ring round a face and nothing else, so it gets no box — just a breath of
 * light behind it, which is what stops a thin ring disappearing into the tile.
 */
.picker-body--compact .picker-art {
  background: radial-gradient(circle at 50% 47%, hsl(var(--primary) / 0.14), transparent 62%);
}

.picker-tag {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  min-height: 15px;
  padding: 0 1px;
  font-size: 0.62rem;
  line-height: 1.25;
  color: hsl(var(--muted-foreground));
}

.picker-cell--active .picker-tag {
  color: hsl(var(--foreground));
}

.picker-tag-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-tick {
  flex: 0 0 auto;
  color: hsl(var(--primary));
}

.picker-shut {
  flex: 0 0 auto;
  color: hsl(var(--muted-foreground));
}

.picker-caption {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-height: 30px;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

.picker-lock-note {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* The way out of an Ultima padlock, said where the padlock is explained. */
.picker-upsell {
  margin-left: 4px;
  font-size: 0.65rem;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-transform: none;
  letter-spacing: normal;
}

.picker-upsell:hover {
  color: hsl(var(--foreground));
}

.picker-axes {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/*
 * The rule above the axes only when there is a list for it to be below.
 *
 * The caption is rendered exactly when the grid is, so it is the honest thing to hang this off. A
 * kind with nothing to choose between opens straight onto its axes, and an unconditional border
 * drew a line across the top of the column with nothing above it.
 */
.picker-caption + .picker-axes {
  padding-top: 12px;
  border-top: 1px solid hsl(var(--border) / 0.5);
}

/*
 * DialogContent is the scroller: the actions stay reachable however tall a preview grows. The
 * dialog's padding varies with the viewport, so the backdrop around them is painted with shadows,
 * which add nothing to the scroll height, rather than with negative margins.
 */
.picker-actions {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 12px;
  background: hsl(var(--background));
  box-shadow:
    -24px 0 0 hsl(var(--background)),
    24px 0 0 hsl(var(--background)),
    0 24px 0 hsl(var(--background)),
    -24px 24px 0 hsl(var(--background)),
    24px 24px 0 hsl(var(--background)),
    0 -1px 0 hsl(var(--border) / 0.4);
}
</style>

<style>
/*
 * Unscoped, and it has to be: DialogContent teleports into a portal, so the element carrying this
 * class is never stamped with this file's scope attribute and a scoped rule would never match it.
 *
 * The dialog is as tall as a profile card plus three more surfaces plus a list, which on a short
 * window is taller than the window — so it is allowed to scroll, and when it does it scrolls with
 * the app's own 6px bar rather than the platform's grey trough down the side of the artwork.
 * Chromium ignores ::-webkit-scrollbar once scrollbar-width or scrollbar-color is set, so both stay auto.
 */
.cosmetic-picker {
  scrollbar-width: auto;
  scrollbar-color: auto;
}

.cosmetic-picker::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.cosmetic-picker::-webkit-scrollbar-track {
  background: transparent;
}

.cosmetic-picker::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.08);
  border-radius: 3px;
}

.cosmetic-picker:hover::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.16);
}

.cosmetic-picker::-webkit-scrollbar-thumb:hover {
  background-color: hsl(var(--foreground) / 0.28);
}
</style>
