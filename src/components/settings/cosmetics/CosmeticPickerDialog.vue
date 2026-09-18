<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { Button } from "@argon/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { IconCheck, IconGift, IconLock, IconQuestionMark, IconSparkles, IconTicket } from "@tabler/icons-vue";
import { useLocale } from "@/store/system/localeStore";
import { useMe } from "@/store/auth/meStore";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { useEscapeDismiss } from "@/lib/modalLayers";
import { cosmeticName } from "@/lib/cosmeticText";
import { resolveKind } from "@/cosmetics/registry";
import {
  slotsOf,
  type CosmeticFacet,
  type CosmeticKindModule,
} from "@/cosmetics/types";
import CosmeticCell from "@/components/settings/cosmetics/CosmeticCell.vue";
import CosmeticLookPreview, { type LookSurface } from "@/cosmetics/CosmeticLookPreview.vue";
import {
  CosmeticAcquisition,
  Ion_CosmeticAcquisition_OpenEnum,
  type ArgonUserProfile,
  type CatalogueCosmetic,
  type CosmeticLoadout,
  type EquippedCosmetic,
  type EquippedCosmeticOption,
} from "@argon/glue";

/**
 * Choosing what to wear on one kind, with room to see it.
 *
 * <b>Everything here is a draft until it is applied.</b> The first cut wrote every click straight to
 * the server, so the profile behind the dialog changed while somebody was still looking through the
 * options — and the button at the bottom did nothing, because there was nothing left for it to do.
 * The dialog now holds its own copy, the preview draws that copy, and closing without applying
 * leaves the loadout exactly as it was found.
 */
const props = defineProps<{
  open: boolean;
  kind: CosmeticKindModule;
  loadout: CosmeticLoadout;
  items: CatalogueCosmetic[];
  busy: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  apply: [slots: (string | null)[], choices: Record<string, string>, tuning: string | null];
}>();

const localeStore = useLocale();
const { t } = localeStore;
const { currentLocale } = storeToRefs(localeStore);
const me = useMe();
const cosmetics = useCosmeticsStore();

const NOTHING_CHOSEN = "none";

const nameOf = (item: CatalogueCosmetic) => cosmeticName(item, currentLocale.value);

const slotCount = computed(() => slotsOf(props.kind));

const stacks = computed(() => slotCount.value > 1);

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
 * 64px box is a dark square, a background in one is a swatch, and a badge in one is a speck.
 *
 * <ul>
 *   <li><b>wide</b> — a background is a picture that fills a surface, so its tile is a picture.</li>
 *   <li><b>tall</b> — a frame surrounds a profile card, and a card is upright. In a square it is
 *       four bands of equal weight, which is the one thing a frame never is.</li>
 *   <li><b>cards</b> — something falling across a card, which wants a card but not an upright
 *       one.</li>
 *   <li><b>compact</b> — a decoration or a badge: no card to be judged on, so the tile is the
 *       thing itself, drawn as large as the tile allows.</li>
 * </ul>
 *
 * Keyed on the primitive rather than the kind key, so a kind added to the build lands in the right
 * shape because of what it draws.
 */
type PickerShape = "wide" | "tall" | "cards" | "compact";

const shape = computed<PickerShape>(() => {
  switch (props.kind.primitive) {
    case "videoLayer": return "wide";

    // Both are a whole card and are judged as one, so both want a tile the shape of a card. A scene
    // arranged against a card's edges in a wide tile is a scene arranged against the wrong edges.
    case "frameAssembly":
    case "sceneStage": return "tall";

    case "cardLayer": return "cards";
    default: return "compact";
  }
});

/** Whether a bare kind is on at all, which is the one thing its row still records. */
const bareWorn = computed(() => props.loadout.equipped.some(item => item.kindKey === props.kind.key));

/** What is worn on this kind right now, by slot. */
function wornSlots(): (string | null)[] {
  const worn: (string | null)[] = Array.from({ length: slotCount.value }, () => null);

  for (const item of props.loadout.equipped) {
    if (item.kindKey === props.kind.key && item.slotIndex < worn.length) worn[item.slotIndex] = item.itemId;
  }

  return worn;
}

/**
 * What the wearer has already decided about this kind, if the kind lets them decide anything.
 *
 * Read off the first row for the same reason the axes are: one thing is being chosen here, and a
 * kind that wears several at once has never had a per-slot setting to read.
 */
function wornTuning(): unknown {
  if (!props.kind.tuning) return null;

  const first = props.loadout.equipped.find(item => item.kindKey === props.kind.key);

  if (!first?.contentJson) return props.kind.tuning.empty();

  try {
    return props.kind.tuning.parse(JSON.parse(first.contentJson)) ?? props.kind.tuning.empty();
  } catch {
    return props.kind.tuning.empty();
  }
}

function wornChoices(): Record<string, string> {
  const chosen: Record<string, string> = {};
  const first = props.loadout.equipped.find(item => item.kindKey === props.kind.key);

  for (const option of first?.options ?? []) {
    chosen[option.facetId] = option.slug;
  }

  return chosen;
}

const slots = ref<(string | null)[]>([]);
const choices = ref<Record<string, string>>({});
const tuning = ref<unknown>(null);

/** Opening starts from what is worn, never from a draft somebody walked away from. */
watch(() => [props.open, props.kind.key], ([open]) => {
  if (!open) return;

  slots.value = wornSlots();
  choices.value = wornChoices();
  tuning.value = wornTuning();
}, { immediate: true });

const picked = computed(() => slots.value.filter((itemId): itemId is string => itemId !== null));

/** Whether the axes and the tuning have anything to act on: something chosen, or a bare kind. */
const configuring = computed(() => bare.value || picked.value.length > 0);

/**
 * Whether the tuning form has anything to say about what is picked.
 *
 * <b>A kind's tuning is not always a kind-wide question.</b> A scene asks how much of the card to
 * play on, and a scene authored to take the whole of it, bottom to top, has one answer and no
 * question — so it says so, and the form goes away rather than sitting there changing nothing. A
 * dial that does not move reads as broken, not as inapplicable.
 */
const tunable = computed(() => {
  const module = props.kind.tuning;

  if (!module?.appliesTo) return true;

  // A bare kind has no row to ask about, and every picked row has to agree: offering a dial that
  // works on one of two chosen things is the same confusion in a smaller place.
  const chosen = props.items.filter(item => picked.value.includes(item.cosmeticId));

  return chosen.length === 0 || chosen.every(item => {
    try {
      return module.appliesTo!(JSON.parse(item.payloadJson));
    } catch {
      return false;
    }
  });
});

/** What the draft would be saved as, and null for a form nobody has filled in. */
const tunedJson = computed(() => {
  const module = props.kind.tuning;

  if (!module || tuning.value === null) return null;

  return module.isEmpty(tuning.value) ? null : JSON.stringify(tuning.value);
});

const wornTunedJson = computed(() => {
  const module = props.kind.tuning;
  const worn = wornTuning();

  if (!module || worn === null) return null;

  return module.isEmpty(worn) ? null : JSON.stringify(worn);
});

const dirty = computed(() => {
  if (JSON.stringify(choices.value) !== JSON.stringify(wornChoices())) return true;
  if (tunedJson.value !== wornTunedJson.value) return true;

  // A bare kind has no slots to compare; putting it on for the first time is a change in itself.
  return bare.value
    ? !bareWorn.value
    : JSON.stringify(slots.value) !== JSON.stringify(wornSlots());
});

useEscapeDismiss(() => props.open, () => emit("update:open", false));

function itemById(itemId: string | null): CatalogueCosmetic | null {
  return props.items.find(item => item.cosmeticId === itemId) ?? null;
}

/** Where an item sits in the draft, counting from one, or null when it is not worn. */
function positionOf(itemId: string): number | null {
  const at = slots.value.indexOf(itemId);

  return at < 0 ? null : at + 1;
}

/**
 * Puts an item on, or takes it off.
 *
 * A kind with one slot replaces what is there. A kind with several appends, and clicking something
 * already on takes it off and closes the gap — so the order is the order they were chosen, which is
 * also the order they are drawn in.
 */
function toggle(item: CatalogueCosmetic | null): void {
  if (item === null) {
    slots.value = Array.from({ length: slotCount.value }, () => null);
    return;
  }

  if (!stacks.value) {
    slots.value = [item.cosmeticId];
    return;
  }

  const kept = picked.value.filter(itemId => itemId !== item.cosmeticId);

  if (kept.length === picked.value.length && kept.length < slotCount.value) kept.push(item.cosmeticId);

  slots.value = Array.from({ length: slotCount.value }, (_, index) => kept[index] ?? null);
}

const axes = computed(() => (props.kind.facets ?? []).filter(facet => cosmetics.isKindEnabled(facet.optionKindKey)));

/** The chosen axis options, shaped the way the wire delivers them. */
function draftOptions(): EquippedCosmeticOption[] {
  const composed: EquippedCosmeticOption[] = [];

  for (const facet of axes.value) {
    const slug = choices.value[facet.id];

    if (!slug || slug === NOTHING_CHOSEN) continue;

    const option = cosmetics.optionsForFacet(facet.optionKindKey).find(row => row.slug === slug);

    if (!option) continue;

    composed.push({
      facetId: facet.id,
      kindKey: option.kindKey,
      itemId: option.cosmeticId,
      slug: option.slug,
      payloadJson: option.payloadJson,
      assets: option.assets,
      version: null,
    });
  }

  return composed;
}

/** Nothing worn, said the way a row says it: the board fields a non-board kind has no use for. */
const NOT_ON_A_BOARD = { boardX: null, boardY: null, boardW: null, boardH: null, version: null };

/** A bare kind wears no item, so its draft row is the axes and the tuning and nothing else. */
function bareRow(): EquippedCosmetic[] {
  return [{
    kindKey: props.kind.key,
    itemId: "00000000-0000-0000-0000-000000000000",
    slug: "",
    layer: props.kind.layer,
    slotIndex: 0,
    payloadJson: "{}",
    assets: [],
    options: draftOptions(),
    contentJson: tunedJson.value,
    ...NOT_ON_A_BOARD,
  }];
}

/** The rest of the look: everything worn that this dialog is not about. */
const rest = computed(() => props.loadout.equipped.filter(item => item.kindKey !== props.kind.key));

function draftRows(): EquippedCosmetic[] {
  return picked.value.map((itemId, index) => {
    const item = itemById(itemId)!;

    return {
      kindKey: item.kindKey,
      itemId: item.cosmeticId,
      slug: item.slug,
      layer: props.kind.layer,
      slotIndex: index,
      payloadJson: item.payloadJson,
      assets: item.assets,
      options: draftOptions(),
      contentJson: tunedJson.value,
      ...NOT_ON_A_BOARD,
    };
  });
}

/**
 * The whole look, with this kind's rows replaced by the draft.
 *
 * <b>On top of the rest of it, not on a blank card.</b> The question being answered is "how does
 * this go with the rest", and it cannot be answered by a stage with nothing else on it.
 */
const draft = computed(() => [...rest.value, ...(bare.value ? bareRow() : draftRows())]);

/**
 * The draft as a reader would receive it: the account's profile, the look's overrides, these rows.
 *
 * <b>A profile rather than a list, because that is what the real card takes.</b> The preview column
 * draws the same component a member of the space draws, and that component reads a profile — so
 * the honest way to show an unsaved draft is to build the profile the server would have sent, and
 * hand it over. Nothing about the draft is special-cased downstream, which is the whole point.
 */
const previewProfile = computed<ArgonUserProfile | null>(() => {
  const base = me.meProfile;

  if (!base) return null;

  return {
    ...base,
    cosmetics: draft.value,
    displayNameOverride: props.loadout.displayNameOverride,
    avatarFileIdOverride: props.loadout.avatarFileIdOverride,
    bio: props.loadout.bioOverride ?? base.bio,
  };
});

/**
 * The room one tile's picture gets.
 *
 * Literals that this file's own grid has to agree with: the grid's `minmax` floor less the 4px of
 * padding on each side. The real tile is a few pixels wider, and telling the difference is not
 * worth a resize observer behind every tile in a scrolling list.
 */
/**
 * The card stands beside the list and the three short ones stack on the far side of it.
 *
 * Which is what keeps the dialog shorter than a screen: a profile card with a board card on it is
 * most of six hundred pixels by itself, and three more surfaces under it were another five.
 */
const CARD_ONLY: readonly LookSurface[] = ["card"];

const THE_SHORT_ONES: readonly LookSurface[] = ["avatar", "message", "memberRow"];

/**
 * How much of the dialog the far column may have.
 *
 * Narrower than the transcript would take on its own, because every pixel it takes is one the
 * list does not — and the list going narrow is what put one background on a row.
 */
const SHORT_COLUMN_WIDTH = 268;

interface Box { width: number; height: number }

const ART_BOXES: Record<PickerShape, Box> = {
  wide: { width: 187, height: 108 },
  tall: { width: 187, height: 248 },
  cards: { width: 187, height: 122 },
  compact: { width: 187, height: 168 },
};

const artBox = computed<Box>(() => ART_BOXES[shape.value]);

/**
 * The tile's picture box, sized from the script rather than from a second copy in the stylesheet.
 *
 * The height has to be here and it has to be a minimum as well: everything drawn inside is
 * positioned absolutely, so the box has no content of its own to be measured by. Without a floor
 * the grid read the picture as taking no room, gave its rows an equal share of the list's maximum
 * height and squashed every frame to a third of itself.
 */
/**
 * Whether the chosen tile is marked by a dot on its label rather than by a ring round it.
 *
 * True wherever the tile is a picture: a ring drawn round a frame is a second frame, in the
 * accent colour, on the outside of the thing whose entire job is to be the outside of a card.
 */
const litByDot = computed(() =>
  shape.value === "tall" || shape.value === "cards" || shape.value === "wide");

const artStyle = computed(() => ({
  height: `${artBox.value.height}px`,
  minHeight: `${artBox.value.height}px`,
}));

const sample = computed(() => props.loadout.displayNameOverride || me.me?.displayName || "Argon");

/** The look's own picture where it has one: a frame is chosen against the face it will sit on. */
const face = computed(() => props.loadout.avatarFileIdOverride ?? me.me?.avatarFileId ?? undefined);

function optionsOn(facet: CosmeticFacet): CatalogueCosmetic[] {
  return cosmetics.optionsForFacet(facet.optionKindKey);
}

function chipOf(optionKindKey: string) {
  return resolveKind(optionKindKey)?.chip ?? null;
}

function payloadOf(item: CatalogueCosmetic): unknown {
  return cosmetics.resolveCatalogueItem(item)?.payload ?? null;
}

function chooseOn(facetId: string, slug: string | null): void {
  choices.value = { ...choices.value, [facetId]: slug ?? NOTHING_CHOSEN };
}

/**
 * The colour of the draft, and a readable stand-in before one is chosen.
 *
 * Every treatment composes a colour, so with none chosen each of them drew nothing and the whole
 * row of them looked identical.
 */
const tint = computed(() => {
  const slug = choices.value.color;
  const option = slug && slug !== NOTHING_CHOSEN
    ? cosmetics.optionsForFacet("option.swatch").find(row => row.slug === slug)
    : null;

  const payload = option ? cosmetics.resolveCatalogueItem(option)?.payload : null;

  return (payload as { hex?: string } | null)?.hex ?? "#a1a1aa";
});

/**
 * The colours the wearer has picked for themselves, for the chips to be drawn in.
 *
 * Without it every treatment previews over one swatch while the name is painted in three colours of
 * their own — samples of something that is not going to happen, and for the treatments that only
 * compose several colours, a row that all looks the same.
 */
const ownStops = computed<readonly string[]>(() => {
  const held = tuning.value as { stops?: readonly string[] | null } | null;

  return held?.stops ?? [];
});

const hovered = ref<CatalogueCosmetic | null>(null);

/** What the caption is about: whatever the pointer is over, else the last thing put on. */
const subject = computed(() => hovered.value ?? itemById(picked.value.at(-1) ?? null));

const lock = computed(() => {
  const item = subject.value;

  if (!item || item.owned) return null;

  const ways = item.acquisition ?? [];

  if (ways.includes(CosmeticAcquisition.UltimaTier)) return { icon: IconSparkles, key: "cosmetic_locked_ultima" };
  if (ways.includes(CosmeticAcquisition.Purchase)) return { icon: IconGift, key: "cosmetic_locked_purchase" };
  if (ways.includes(CosmeticAcquisition.PromoCode)) return { icon: IconTicket, key: "cosmetic_locked_promo" };

  // Nothing here names a route this build can read, so this build cannot say how the thing is come
  // by — and saying so is the only honest caption left.
  //
  // An empty list is expected, not a fault. A cosmetic that only falls out of a case carries `Drop`
  // on the admin contract, and `CosmeticAcquisition` — the player-facing enum — has no such member,
  // so the server emits nothing at all for it. The enum is deliberately not extended to add one: an
  // installed client decodes a member it does not declare but has no label for it, which lands it
  // right back here, and a client release is not something a new case should require. The same holds
  // for a route a newer server does know and this one does not.
  //
  // The alternative was falling through to `cosmetic_locked_grant`, which points the player at an
  // operator — nobody hands out a case drop by request, so that caption sends them somewhere real to
  // ask for something that cannot be given.
  if (!ways.some(way => Ion_CosmeticAcquisition_OpenEnum.isKnown(way))) {
    return { icon: IconQuestionMark, key: "cosmetic_locked_unknown" };
  }

  return { icon: IconLock, key: "cosmetic_locked_grant" };
});

function apply(): void {
  emit("apply", bare.value ? [] : [...slots.value], { ...choices.value }, tunedJson.value);
  emit("update:open", false);
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

  emit("apply", [null], {}, null);
  emit("update:open", false);
}

/** Whether there is anything to take off: something in the draft, or a bare kind that is on. */
const wearing = computed(() => (bare.value ? bareWorn.value : picked.value.length > 0));
</script>

<template>
  <!--
    Width as utility classes rather than a scoped rule. DialogContent carries its own
    `w-full max-w-[calc(100%-2rem)]` and teleports into a portal, so a scoped class never picks up
    the scope attribute and loses the tie on order — the dialog came out the width of the screen.
  -->
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="cosmetic-picker w-[1180px] max-w-[94vw] max-h-[92vh] overflow-x-clip overflow-y-auto">
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
        <div v-if="!bare" class="picker-grid">
          <button
            v-for="item in items"
            :key="item.cosmeticId"
            class="picker-cell"
            :class="{ 'picker-cell--active': positionOf(item.cosmeticId) !== null, 'picker-cell--locked': !item.owned }"
            :title="nameOf(item)"
            :disabled="busy || !item.owned"
            @click="toggle(item)"
            @mouseenter="hovered = item"
            @mouseleave="hovered = null"
          >
            <span class="picker-art" :style="artStyle">
              <CosmeticCell
                :item="item"
                :width="artBox.width"
                :height="artBox.height"
                :sample="sample.slice(0, 8)"
                :avatar-user-id="me.me?.userId"
                :avatar-file-id="face"
              />
            </span>

            <!--
              What is true about this one, said on the tile's own strip rather than over the
              picture. A tick, a place in the row or a padlock printed on top of a frame is printed
              on the thing being judged — and the strip has room for the name as well, which is the
              only way to tell two badges the size of a full stop apart.
            -->
            <span class="picker-tag">
              <span v-if="stacks && positionOf(item.cosmeticId)" class="picker-order">
                {{ positionOf(item.cosmeticId) }}
              </span>
              <template v-else-if="positionOf(item.cosmeticId) !== null">
                <span v-if="litByDot" class="picker-dot" />
                <IconCheck v-else class="picker-tick w-3 h-3" />
              </template>
              <IconLock v-else-if="!item.owned" class="picker-shut w-3 h-3" />

              <span class="picker-tag-name">{{ nameOf(item) }}</span>
            </span>
          </button>
        </div>

        <!--
          How the thing under the pointer is come by, and nothing else. It used to name it too,
          which was the same word the tile itself already carries an inch above — the only reason
          anybody looked down here was to find out why something had a padlock on it.
        -->
        <div v-if="!bare" class="picker-caption">
          <div v-if="lock" class="picker-lock-note">
            <component :is="lock.icon" class="w-3 h-3" />
            <span>{{ t(lock.key) }}</span>
          </div>
        </div>

        <!--
          The axes of whatever is on. They belong to the thing being chosen, so they live beside
          the list and not under the whole dialog, and they read from the draft like everything
          else here.
        -->
        <div v-if="configuring && axes.length > 0" class="picker-axes">
        <div v-for="facet in axes" :key="facet.id" class="picker-axis">
          <div class="picker-axis-head">
            <span>{{ t(facet.labelKey) }}</span>
            <button
              v-if="choices[facet.id] && choices[facet.id] !== NOTHING_CHOSEN"
              class="picker-axis-clear"
              @click="chooseOn(facet.id, null)"
            >{{ t("reset") }}</button>
          </div>

          <div v-if="optionsOn(facet).length === 0" class="text-xs text-muted-foreground">
            {{ t("cosmetic_nothing_here_yet") }}
          </div>

          <div v-else class="picker-axis-options">
            <button
              v-for="option in optionsOn(facet)"
              :key="option.cosmeticId"
              class="picker-axis-option"
              :class="{
                'picker-axis-option--active': choices[facet.id] === option.slug,
                'picker-axis-option--locked': !option.owned,
              }"
              :title="nameOf(option)"
              :disabled="!option.owned"
              @click="chooseOn(facet.id, choices[facet.id] === option.slug ? null : option.slug)"
            >
              <component
                :is="chipOf(facet.optionKindKey)"
                v-if="chipOf(facet.optionKindKey)"
                :slug="option.slug"
                :payload="payloadOf(option)"
                :sample="sample.slice(0, 3)"
                :tint="tint"
                :stops="ownStops"
              />
              <span v-else>{{ nameOf(option) }}</span>

              <IconLock v-if="!option.owned" class="picker-lock w-3 h-3" />
            </button>
          </div>
        </div>
        </div>

        <!--
          The part of this that is nobody else's to decide. Only shown once something is on,
          because there is nothing to tune about an empty slot.
        -->
        <component
          :is="kind.tuning!.editor"
          v-if="kind.tuning && configuring && tunable && tuning !== null"
          :content="tuning"
          :disabled="busy"
          @update:content="tuning = $event"
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

      <div class="flex justify-end gap-2">
        <Button v-if="wearing" size="sm" variant="ghost" class="mr-auto text-destructive"
          :disabled="busy" @click="clear">
          {{ t("cosmetic_clear") }}
        </Button>

        <Button size="sm" variant="ghost" :disabled="busy" @click="emit('update:open', false)">
          {{ t("cancel") }}
        </Button>
        <Button size="sm" :disabled="busy || !dirty" @click="apply">{{ t("apply") }}</Button>
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
 * card. So for the three that are pictures the ring, the tint and the coloured border all go,
 * and what is left is a lit dot and the name in full strength.
 */
.picker-body--tall .picker-cell--active,
.picker-body--cards .picker-cell--active,
.picker-body--wide .picker-cell--active {
  border-color: hsl(var(--border) / 0.5);
  box-shadow: none;
  background: hsl(var(--secondary) / 0.4);
}

.picker-body--tall .picker-cell--active .picker-tag,
.picker-body--cards .picker-cell--active .picker-tag,
.picker-body--wide .picker-cell--active .picker-tag {
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
 * A background is the whole of its tile and has no overhang, so the tile holds it to its edge.
 * The tint underneath is what is seen while the clip is still loading.
 */
.picker-body--wide .picker-art {
  overflow: hidden;
  background: hsl(var(--secondary) / 0.4);
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

/* Which one it is in the row, for a kind that wears several at once. */
.picker-order {
  flex: 0 0 auto;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 0.56rem;
  font-weight: 700;
  line-height: 14px;
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

.picker-axis-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.72rem;
  color: hsl(var(--muted-foreground));
}

.picker-axis-clear {
  font-size: 0.68rem;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.picker-axis-clear:hover {
  color: hsl(var(--foreground));
}

/*
 * Onto the next line rather than off the side.
 *
 * A row that scrolls hides how many faces there are behind a bar somebody has to notice and then
 * drag, and the axis is a list of maybe ten things — wrapping shows all of them and costs one
 * more line of the dialog.
 */
.picker-axis-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 5px;
}

.picker-axis-option {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 34px;
  padding: 0 9px;
  border-radius: 9px;
  border: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--background));
}

.picker-axis-option--active {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 1px hsl(var(--primary));
}

.picker-axis-option--locked {
  opacity: 0.5;
}

/* An axis option is a chip with no strip to put anything on, so its padlock sits over the corner. */
.picker-lock {
  position: absolute;
  top: 2px;
  right: 2px;
  color: hsl(var(--muted-foreground));
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
 */
.cosmetic-picker::-webkit-scrollbar {
  width: 6px;
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
