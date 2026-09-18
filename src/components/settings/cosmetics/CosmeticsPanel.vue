<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { Button } from "@argon/ui/button";
import { Input } from "@argon/ui/input";
import { useToast } from "@argon/ui/toast";
import { IconCheck, IconChevronRight, IconPencil, IconPlus, IconStar, IconSearch, IconServer2, IconTrash, IconWorld, IconX, IconZzz } from "@tabler/icons-vue";
import { useLocale } from "@/store/system/localeStore";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { useMe } from "@/store/auth/meStore";
import { usePoolStore } from "@/store/data/poolStore";
import { cosmeticKinds } from "@/cosmetics/registry";
import { cosmeticName } from "@/lib/cosmeticText";
import { isCompositional } from "@/cosmetics/types";
import CosmeticBoardEditor from "@/components/settings/cosmetics/CosmeticBoardEditor.vue";
import CosmeticIdentityEditor from "@/components/settings/cosmetics/CosmeticIdentityEditor.vue";
import CosmeticRowPreview from "@/components/settings/cosmetics/CosmeticRowPreview.vue";
import CosmeticPickerDialog from "@/components/settings/cosmetics/CosmeticPickerDialog.vue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import type { CatalogueCosmetic, CosmeticLoadout, WidgetCard } from "@argon/glue";

/**
 * Where a person picks what they wear, and where.
 *
 * Kept out of ProfileSettings.vue rather than added to it: that file is already past two and a half
 * thousand lines and holds sessions, passkeys, phone, email and the danger zone as well as the
 * profile. This is a subject of its own.
 *
 * <b>Nothing here knows what a cosmetic is.</b> The kinds come from the registry, the items from the
 * catalogue, and the slots from the kind — so a kind added to the build appears here with no change
 * to this file, and one removed disappears from it.
 */
const localeStore = useLocale();
const { t } = localeStore;
const { currentLocale } = storeToRefs(localeStore);
const { toast } = useToast();

const me = useMe();
const cosmetics = useCosmeticsStore();
const pool = usePoolStore();
const spaces = pool.useAllServers();

/** Which kind's picker is open, by key. */
const editing = ref<string | null>(null);

const openKind = computed(() => kinds.value.find(kind => kind.key === editing.value) ?? null);

/**
 * What the line says is on: the thing's name, or how many of them for a kind that wears several.
 *
 * Naming one of three badges would be naming the wrong one, and naming all three would not fit.
 */
function wornLabel(kindKey: string): string {
  const worn = selected.value?.equipped.filter(item => item.kindKey === kindKey) ?? [];

  if (worn.length === 0) return t("none");

  if (worn.length > 1) return t("cosmetic_worn_count", { count: worn.length });

  // A bare kind has no row to name. What it is, is what was set on it, and the line beside this
  // already draws that — so the word here is only whether anything was.
  if (kinds.value.find(kind => kind.key === kindKey)?.bare) return t("cosmetic_configured");

  const item = itemsOf(kindKey).find(candidate => candidate.cosmeticId === worn[0].itemId);

  return item ? cosmeticName(item, currentLocale.value) : t("none");
}

/**
 * Writes a whole kind at once: every slot as the dialog left it, and the axis choices with it.
 *
 * Slot by slot rather than a diff, because a slot is the unit the server stores and the cost of
 * being exact here is a handful of calls on a button nobody presses twice. Emptied slots are
 * unequipped, which is what closing a gap in the middle of a row has to mean.
 */
async function applyKind(
  kindKey: string,
  slots: (string | null)[],
  choices: Record<string, string>,
  tuning: string | null,
): Promise<void> {
  const loadoutId = selectedLoadoutId.value;

  if (!loadoutId) return;

  const overrides = Object.keys(choices).length > 0 ? JSON.stringify(choices) : null;
  const kind = kinds.value.find(entry => entry.key === kindKey);

  await run(async () => {
    // A bare kind has nothing to equip: configuring it is putting it on, and the dialog says "take
    // it off" by sending a single empty slot.
    if (kind?.bare) {
      if (slots.length > 0 && slots[0] === null) {
        await cosmetics.unequip(loadoutId, kindKey, 0);
        await cosmetics.loadLoadouts();
        return true;
      }

      const configured = await cosmetics.configureCosmetic(loadoutId, kindKey, 0, overrides, tuning);

      await cosmetics.loadLoadouts();

      return configured;
    }

    let applied = true;

    for (let slot = 0; slot < slots.length; slot++) {
      const itemId = slots[slot];

      const answer = itemId === null
        ? await cosmetics.unequip(loadoutId, kindKey, slot)
        : await cosmetics.equip(loadoutId, itemId, slot, overrides ?? undefined);

      if (answer === null && itemId !== null) applied = false;
    }

    // Only after the equip, and only for a kind with something to fill in: what a wearer writes
    // belongs to something worn, so there is nothing to write it onto until the slot is filled.
    if (kind?.tuning && slots[0] !== null
      && !(await cosmetics.configureCosmetic(loadoutId, kindKey, 0, overrides, tuning))) {
      applied = false;
    }

    // One authoritative read at the end. Each call refreshes on its own, but a refused one — clearing
    // a slot that was already empty, which most of this loop is — returns without refreshing, so the
    // last word could be an answer from the middle of the batch.
    await cosmetics.loadLoadouts();

    return applied;
  }, "cosmetic_equip_failed");
}

/** Real letters rather than "Abc": a face is judged on the name it is actually going to set. */
const sample = computed(() => me.me?.displayName?.slice(0, 8) || "Argon");

/**
 * Which look is open. Held in the store rather than here, because the profile card above this panel
 * previews it — a preview of a different look than the one being edited previews nothing.
 */
const selectedLoadoutId = computed({
  get: () => cosmetics.editing,
  set: value => { cosmetics.editing = value; },
});
const newLoadoutName = ref("");
const renaming = ref<string | null>(null);
const renameTo = ref("");
const busy = ref(false);

onMounted(async () => {
  await Promise.all([cosmetics.loadLoadouts(), cosmetics.loadCatalogue()]);

  selectedLoadoutId.value =
    cosmetics.loadouts?.loadouts.find(loadout => loadout.isDefault)?.loadoutId
    ?? cosmetics.loadouts?.loadouts.at(0)?.loadoutId
    ?? null;
});

const loadouts = computed<CosmeticLoadout[]>(() => [...(cosmetics.loadouts?.loadouts ?? [])]);

const selected = computed(() => loadouts.value.find(loadout => loadout.loadoutId === selectedLoadoutId.value) ?? null);

/**
 * Only the kinds this build ships, the platform has switched on, and somebody can actually wear.
 *
 * A kind an operator turned off has to be absent rather than shown-and-disabled: the whole promise
 * is that the feature stops existing, and a greyed-out row is the opposite of that. Compositional
 * kinds are absent for a different reason — a colour is not a thing you wear, it is a thing you
 * choose on the axis of something you do.
 */
const kinds = computed(() =>
  cosmeticKinds.filter(kind =>
    !isCompositional(kind) && !kind.board && cosmetics.isKindEnabled(kind.key)),
);

/**
 * Writes a look's whole board.
 *
 * One call for the lot, because the order is a property of the board and not of any card in it.
 */
async function applyBoard(cards: WidgetCard[]): Promise<void> {
  const loadoutId = selectedLoadoutId.value;

  if (!loadoutId) return;

  await run(() => cosmetics.setWidgetBoard(loadoutId, cards), "cosmetic_equip_failed");
}

/**
 * Everything published of this kind, owned or not.
 *
 * Showing the locked ones is the point: a picker that listed only what you already have cannot tell
 * you what exists, and an account with nothing looks exactly like an empty catalogue. Owned first,
 * so what you can actually use is not buried.
 */
function itemsOf(kindKey: string): CatalogueCosmetic[] {
  return (cosmetics.catalogue?.items ?? [])
    .filter(item => item.kindKey === kindKey)
    .sort((left, right) => Number(right.owned) - Number(left.owned));
}

function equippedIn(loadout: CosmeticLoadout | null, kindKey: string): string | null {
  return loadout?.equipped.find(item => item.kindKey === kindKey)?.itemId ?? null;
}

async function run(action: () => Promise<boolean>, failure: string): Promise<void> {
  busy.value = true;

  try {
    if (!(await action())) toast({ title: t("error"), description: t(failure), variant: "destructive" });
  } finally {
    busy.value = false;
  }
}

async function createLoadout(): Promise<void> {
  const name = newLoadoutName.value.trim();

  if (!name) return;

  busy.value = true;

  try {
    const created = await cosmetics.createLoadout(name);

    if (!created) {
      toast({ title: t("error"), description: t("cosmetic_loadout_failed"), variant: "destructive" });
      return;
    }

    newLoadoutName.value = "";
    selectedLoadoutId.value = created;
  } finally {
    busy.value = false;
  }
}

async function commitRename(loadoutId: string): Promise<void> {
  const name = renameTo.value.trim();

  renaming.value = null;

  if (!name) return;

  await run(() => cosmetics.renameLoadout(loadoutId, name), "cosmetic_loadout_failed");
}

/** Which look holds a scope, if any. Null means it falls through to the default. */
function heldBy(spaceId: string | null): string | null {
  return cosmetics.loadouts?.assignments.find(a => (a.spaceId ?? null) === spaceId)?.loadoutId ?? null;
}

function nameOfLook(loadoutId: string | null): string | null {
  return loadouts.value.find(loadout => loadout.loadoutId === loadoutId)?.name ?? null;
}

/**
 * Whether the selected look is the one worn everywhere nothing else claims.
 *
 * Exactly one look can be, because the global assignment is a single row — so switching it on here
 * takes it from whichever look had it.
 */
const wornEverywhere = computed(() =>
  selected.value !== null && !selected.value.isPaused && heldBy(null) === selected.value.loadoutId);

/** Put away: worn nowhere, and keeping every space it holds for when it comes back out. */
const putAway = computed(() => selected.value?.isPaused === true);

/**
 * The three answers to "where is this worn", as one choice.
 *
 * <b>Nowhere is a place.</b> It was missing, and the only way to say it was to take the spaces off
 * the look one at a time — so the list of spaces was doing duty as an on switch and was lost every
 * time somebody turned it off. Now it is put away with its spaces intact.
 */
type Scope = "everywhere" | "chosen" | "nowhere";

const scope = computed<Scope>(() => putAway.value ? "nowhere" : wornEverywhere.value ? "everywhere" : "chosen");

async function setScope(next: Scope): Promise<void> {
  const look = selected.value;

  if (!look || scope.value === next) return;

  await run(
    async () => {
      if (next === "nowhere") return await cosmetics.setLoadoutPaused(look.loadoutId, true);

      // Coming back out is its own call, and it goes first: the look has to be in play before the
      // assignment that says where, or a failure in between leaves it claiming a scope it is not
      // wearing.
      if (putAway.value && !(await cosmetics.setLoadoutPaused(look.loadoutId, false))) return false;

      if (next === "everywhere") return await cosmetics.assignLoadoutToSpace(null, look.loadoutId);

      // Letting "everywhere" go only ever touches the global row when this look is the one holding
      // it. Otherwise the click would take it from whichever look does, which is not what a button
      // on some other look can possibly mean.
      return wornEverywhere.value ? await cosmetics.unassignLoadoutFromSpace(null) : true;
    },
    "cosmetic_assign_failed",
  );
}

/**
 * How many space tiles may exist at once.
 *
 * An account in hundreds of spaces would otherwise put hundreds of avatars in the DOM for a picker
 * most people open once. The search is what makes a cap usable rather than a wall: anything not
 * rendered is one word away.
 */
const SPACE_WINDOW = 36;

const spaceQuery = ref("");

/** Spaces already on this look, which stay visible whatever the search says. */
const pickedSpaces = computed(() =>
  spaces.value.filter(space => heldBy(space.spaceId) === selected.value?.loadoutId),
);

const matchingSpaces = computed(() => {
  const query = spaceQuery.value.trim().toLowerCase();

  return query ? spaces.value.filter(space => space.name.toLowerCase().includes(query)) : spaces.value;
});

/**
 * The tiles that fit, in the order the list has them.
 *
 * <b>Being picked decides which tiles survive the cap, not where they sit.</b> Sorting the picked
 * ones to the front made a tile jump out from under the cursor the moment it was ticked, and the
 * next click landed on whatever had slid into its place. What you have chosen still cannot be the
 * thing that got cut off — that is what the cap is chosen by — but nothing moves.
 */
const visibleSpaces = computed(() => {
  const matches = matchingSpaces.value;

  if (matches.length <= SPACE_WINDOW) return matches;

  const mine = (spaceId: string) => heldBy(spaceId) === selected.value?.loadoutId;

  const kept = new Set(
    [...matches.filter(space => mine(space.spaceId)), ...matches.filter(space => !mine(space.spaceId))]
      .slice(0, SPACE_WINDOW)
      .map(space => space.spaceId),
  );

  return matches.filter(space => kept.has(space.spaceId));
});

const hiddenSpaceCount = computed(() => Math.max(0, matchingSpaces.value.length - SPACE_WINDOW));

/**
 * Puts a space on the selected look, or takes it off.
 *
 * <b>A space belongs to one look at a time</b> — that is the database's rule, one assignment row per
 * space — so ticking it here takes it from whichever look had it. The tile says which one, because
 * silently moving somebody's space out of another look is the kind of thing people discover much
 * later and cannot explain.
 */
async function toggleSpace(spaceId: string): Promise<void> {
  if (!selected.value) return;

  const mine = heldBy(spaceId) === selected.value.loadoutId;

  await run(
    () =>
      mine
        ? cosmetics.unassignLoadoutFromSpace(spaceId)
        : cosmetics.assignLoadoutToSpace(spaceId, selected.value!.loadoutId),
    "cosmetic_assign_failed",
  );
}
</script>

<template>
  <div v-if="kinds.length" class="setting-card">
    <div class="flex items-center gap-2 mb-1">
      <IconStar class="w-5 h-5 text-primary" />
      <h3 class="text-lg font-semibold">{{ t("cosmetic_loadouts") }}</h3>
    </div>
    <p class="text-xs text-muted-foreground mb-5">{{ t("cosmetic_loadouts_hint") }}</p>

    <!-- The personas themselves -->
    <div class="flex flex-wrap items-center gap-2 mb-5">
      <template v-for="loadout in loadouts" :key="loadout.loadoutId">
        <div v-if="renaming === loadout.loadoutId" class="flex items-center gap-1">
          <Input
            v-model="renameTo"
            class="h-8 w-40"
            :maxlength="64"
            @keydown.enter="commitRename(loadout.loadoutId)"
            @keydown.esc="renaming = null"
          />
          <Button size="sm" variant="ghost" :disabled="busy" @click="commitRename(loadout.loadoutId)">
            <IconCheck class="w-4 h-4" />
          </Button>
        </div>

        <button
          v-else
          class="loadout-chip"
          :class="{
            'loadout-chip--active': loadout.loadoutId === selectedLoadoutId,
            'loadout-chip--away': loadout.isPaused,
          }"
          @click="selectedLoadoutId = loadout.loadoutId"
        >
          <IconZzz v-if="loadout.isPaused" class="w-3 h-3" :title="t('cosmetic_scope_off')" />
          <IconStar v-else-if="loadout.isDefault" class="w-3 h-3 text-primary" :title="t('cosmetic_loadout_default')" />
          {{ loadout.name }}
        </button>
      </template>

      <div class="flex items-center gap-1">
        <Input
          v-model="newLoadoutName"
          class="h-8 w-40"
          :maxlength="64"
          :placeholder="t('cosmetic_loadout_new')"
          @keydown.enter="createLoadout"
        />
        <Button size="sm" variant="ghost" :disabled="busy || !newLoadoutName.trim()" @click="createLoadout">
          <IconPlus class="w-4 h-4" />
        </Button>
      </div>
    </div>

    <div v-if="selected" class="space-y-5">
      <div class="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          :disabled="busy"
          @click="renaming = selected.loadoutId; renameTo = selected.name"
        >
          <IconPencil class="w-3.5 h-3.5 mr-1" />{{ t("rename") }}
        </Button>
        <!--
          "Make this the default" used to live here, and it was the same act as choosing "Везде"
          below — two controls writing one fact, one of them out of sight of the picker that claims
          to say where a look is worn. The picker is the one that stays.

          The look worn everywhere cannot be removed while others exist, because that would silently
          strip every space that has not chosen one — but the last one can be, because no looks at
          all is a perfectly ordinary state. Without that second half, the first look somebody makes
          is the one they are stuck with.
        -->
        <Button
          v-if="!selected.isDefault || loadouts.length === 1"
          size="sm"
          variant="ghost"
          class="text-destructive"
          :disabled="busy"
          @click="run(() => cosmetics.deleteLoadout(selected!.loadoutId), 'cosmetic_loadout_failed')"
        >
          <IconTrash class="w-3.5 h-3.5 mr-1" />{{ t("delete") }}
        </Button>
      </div>

      <!--
        One line per kind, and the choosing happens in a window.

        The shelves this replaces were five rows of tiles, opened at once, filling the pane before it
        had said anything — and still too small to tell two frames apart. A line says what is on; the
        dialog is where there is room to look.
      -->
      <div class="worn-list">
        <button
          v-for="kind in kinds"
          :key="kind.key"
          class="worn-row"
          :disabled="busy"
          @click="editing = kind.key"
        >
          <CosmeticRowPreview :kind="kind" :loadout="selected" />

          <span class="worn-label">{{ t(kind.labelKey) }}</span>
          <span class="worn-value">{{ wornLabel(kind.key) }}</span>
          <IconChevronRight class="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <CosmeticPickerDialog
        v-if="openKind && selected"
        :open="editing !== null"
        :kind="openKind"
        :loadout="selected"
        :items="itemsOf(openKind.key)"
        :busy="busy"
        @update:open="editing = $event ? editing : null"
        @apply="(slots, choices, tuning) => applyKind(openKind!.key, slots, choices, tuning)"
      />

      <!--
        Who this look is, before what it wears: a look overrides the account's name, picture and bio
        in the spaces it applies to, and inherits each of them until it does.
      -->
      <CosmeticIdentityEditor :loadout="selected" :busy="busy" @saved="cosmetics.loadLoadouts()" />

      <!--
        The board, which is a different thing from the list above: those are worn as an operator made
        them, a card is a frame its wearer writes into.
      -->
      <CosmeticBoardEditor :loadout="selected" :busy="busy" @apply="applyBoard" />

      <div class="scope-block">
        <div class="text-sm font-medium mb-2">{{ t("cosmetic_where_worn") }}</div>

        <div class="scope-modes">
          <button class="scope-mode" :class="{ 'scope-mode--active': scope === 'everywhere' }" :disabled="busy"
            @click="setScope('everywhere')">
            <IconWorld class="w-4 h-4" />
            <span>{{ t("cosmetic_scope_everywhere") }}</span>
          </button>
          <button class="scope-mode" :class="{ 'scope-mode--active': scope === 'chosen' }" :disabled="busy"
            @click="setScope('chosen')">
            <IconServer2 class="w-4 h-4" />
            <span>{{ t("cosmetic_scope_chosen") }}</span>
          </button>
          <button class="scope-mode" :class="{ 'scope-mode--active': scope === 'nowhere' }" :disabled="busy"
            @click="setScope('nowhere')">
            <IconZzz class="w-4 h-4" />
            <span>{{ t("cosmetic_scope_off") }}</span>
          </button>
        </div>

        <!-- Closed unless there is something to choose: worn everywhere, or not worn at all. -->
        <p v-if="scope !== 'chosen'" class="text-xs text-muted-foreground mt-2">
          {{ scope === "nowhere" ? t("cosmetic_scope_off_hint") : t("cosmetic_scope_everywhere_hint") }}
        </p>

        <div v-else-if="spaces.length === 0" class="text-xs text-muted-foreground mt-2">
          {{ t("cosmetic_scope_no_spaces") }}
        </div>

        <template v-else>
          <!--
            The third state, said out loud: a look neither worn everywhere nor picked for any space is
            worn nowhere. Leaving it unsaid made losing "everywhere" to another look look like the
            mode had been switched at random.
          -->
          <p class="text-xs text-muted-foreground mt-2">
            {{ pickedSpaces.length > 0 ? t("cosmetic_scope_chosen_hint") : t("cosmetic_scope_nowhere") }}
          </p>

          <!--
            Searchable, and bounded. Everything here is already in memory — the space list comes from
            the local database — so what is being limited is how many tiles exist in the DOM, which
            is the part that hurts on an account in hundreds of spaces.
          -->
          <div class="scope-search">
            <IconSearch class="w-3.5 h-3.5 text-muted-foreground" />
            <input
              v-model="spaceQuery"
              type="text"
              class="scope-search-input"
              :placeholder="t('search_placeholder')"
            />
          </div>

          <div class="scope-spaces">
            <button
              v-for="space in visibleSpaces"
              :key="space.spaceId"
              class="scope-space"
              :class="{ 'scope-space--picked': heldBy(space.spaceId) === selected!.loadoutId }"
              :disabled="busy"
              @click="toggleSpace(space.spaceId)"
            >
              <ArgonAvatar class="rounded-xl" :fallback="space.name" :file-id="space.avatarFieldId"
                :space-id="space.spaceId" :overrided-size="34" />
              <span class="scope-space-name">{{ space.name }}</span>

              <!-- Whose it is now, so taking it is a choice rather than a surprise. -->
              <span
                v-if="heldBy(space.spaceId) && heldBy(space.spaceId) !== selected!.loadoutId"
                class="scope-space-held"
              >{{ nameOfLook(heldBy(space.spaceId)) }}</span>

              <IconCheck v-if="heldBy(space.spaceId) === selected!.loadoutId" class="scope-space-tick w-3.5 h-3.5" />
            </button>
          </div>

          <p v-if="hiddenSpaceCount > 0" class="text-xs text-muted-foreground mt-2">
            {{ t("cosmetic_scope_more", { count: hiddenSpaceCount }) }}
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.loadout-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--secondary));
  font-size: 0.8rem;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.loadout-chip:hover {
  border-color: hsl(var(--primary) / 0.6);
}

/* Dimmed rather than hidden: it is still a look, it is just not being worn. */
.loadout-chip--away {
  opacity: 0.55;
}

.loadout-chip--active {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.12);
}


.worn-list {
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.5);
  overflow: hidden;
}

/*
 * One gutter all the way round the picture.
 *
 * Twelve at the sides, eight above and below.
 *
 * The sides were already where they belong; what was wrong was three pixels of air above and
 * below a picture with twelve beside it, which pinned it to the top of the row. The row grew by
 * the four pixels that fixing it cost and the picture stayed where it was horizontally.
 */
.worn-row {
  display: flex;
  align-items: center;
  gap: 12px;
  /* Fixed, not derived: the label's line box rounds differently per row and rows came out a pixel apart. */
  height: 58px;
  padding: 0 12px;
  background: hsl(var(--background));
  text-align: left;
}

.worn-row + .worn-row {
  border-top: 1px solid hsl(var(--border) / 0.4);
}

.worn-row:not(:disabled):hover {
  background: hsl(var(--secondary) / 0.4);
}

.worn-label {
  flex: 1;
  font-size: 0.82rem;
}

.worn-value {
  font-size: 0.76rem;
  color: hsl(var(--muted-foreground));
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scope-block {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid hsl(var(--border) / 0.4);
}

/*
 * Two separate buttons, not one segmented strip.
 *
 * As a strip they ran together: this control has a third state where neither half is chosen, so
 * neither is highlighted, and with nothing to separate them the two halves read as a single pill
 * with two labels printed on it.
 */
.scope-modes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.scope-mode {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border) / 0.7);
  background: hsl(var(--background));
  font-size: 0.78rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.scope-mode:not(:disabled):hover {
  border-color: hsl(var(--foreground) / 0.35);
  color: hsl(var(--foreground));
}

.scope-mode--active {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--foreground));
}

.scope-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  max-width: 260px;
}

.scope-search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-size: 0.78rem;
}

/* A strip rather than a grid: many spaces stay one row deep, and the row scrolls. */
.scope-spaces {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  overflow-x: auto;
  padding-bottom: 6px;
  scrollbar-width: thin;
}

.scope-space {
  flex: 0 0 auto;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 92px;
  padding: 9px 6px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  transition: border-color 0.15s ease, background 0.15s ease;
}

.scope-space:not(:disabled):hover {
  border-color: hsl(var(--primary) / 0.6);
}

.scope-space--picked {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.12);
}

.scope-space-name {
  font-size: 0.7rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scope-space-held {
  font-size: 0.6rem;
  color: hsl(var(--muted-foreground));
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scope-space-tick {
  position: absolute;
  top: 5px;
  right: 5px;
  color: hsl(var(--primary));
}
</style>
