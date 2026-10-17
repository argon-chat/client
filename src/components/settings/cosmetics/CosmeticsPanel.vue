<script setup lang="ts">
import {
  computed,
  onMounted,
  ref,
} from "vue";
import {
  IconChevronRight,
  IconStar,
} from "@tabler/icons-vue";
import { storeToRefs } from "pinia";
import type { CosmeticError } from "@argon/glue";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";

import CosmeticPickerDialog from "@/components/settings/cosmetics/CosmeticPickerDialog.vue";
import CosmeticRowPreview from "@/components/settings/cosmetics/CosmeticRowPreview.vue";
import {
  refusalOf,
  type WardrobeChange,
} from "@/components/settings/cosmetics/wardrobeChange";
import { asWornItem } from "@/cosmetics/wornEntry";
import { cosmeticErrorKey } from "@/lib/refusals";
import { cosmeticName } from "@/lib/cosmeticText";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { useLocale } from "@/store/system/localeStore";
import { useMe } from "@/store/auth/meStore";

/**
 * Where a person picks what they wear.
 *
 * Kept out of ProfileSettings.vue rather than added to it: that file is already past two and a half
 * thousand lines and holds sessions, passkeys, phone, email and the danger zone as well as the
 * profile. This is a subject of its own.
 *
 * <b>Nothing here knows what a cosmetic is.</b> The kinds come from the registry, the items from the
 * catalogue — so a kind added to the build appears here with no change to this file, and one removed
 * disappears from it.
 */
withDefaults(defineProps<{
  canUpsell?: boolean;
}>(), {
  canUpsell: false,
});

const emit = defineEmits<{
  upsell: [];
}>();

const localeStore = useLocale();
const { t } = localeStore;
const { currentLocale } = storeToRefs(localeStore);
const { toast } = useToast();

const me = useMe();
const { meProfile } = storeToRefs(me);
const cosmetics = useCosmeticsStore();

/** Which kind's picker is open, by key. */
const editing = ref<string | null>(null);

const openKind = computed(() => kinds.value.find(kind => kind.key === editing.value) ?? null);

/** What the line says is on: the thing's name. */
function wornLabel(kindKey: string): string {
  const worn = cosmetics.wornOfKind(meProfile.value, kindKey);

  if (worn === null) {
    return t("none");
  }

  // A bare kind has no row to name. What it is, is what was set on it, and the line beside this
  // already draws that — so the word here is only whether anything was.
  if (kinds.value.find(kind => kind.key === kindKey)?.bare) {
    return t("cosmetic_configured");
  }

  const item = cosmetics.itemById(asWornItem(worn)?.itemId);

  return item ? cosmeticName(item, currentLocale.value) : t("none");
}

/**
 * Writes a whole kind at once: what the dialog left on it, or that it is off.
 *
 * The dialog stays up until the server has taken it, so a refusal leaves the draft where it was.
 */
async function applyKind(change: WardrobeChange): Promise<void> {
  const applied = await run(async () => {
    const answer = change.action === "equip"
      ? await cosmetics.equip(change.worn)
      : await cosmetics.unequip(change.kindKey);

    return refusalOf(change, answer);
  });

  if (applied) {
    editing.value = null;
  }
}

const busy = ref(false);

onMounted(async () => {
  await cosmetics.ensureLoaded();
});

/**
 * Only the kinds this build ships, the platform has switched on, and somebody can actually wear.
 *
 * A kind an operator turned off has to be absent rather than shown-and-disabled: the whole promise
 * is that the feature stops existing, and a greyed-out row is the opposite of that. Compositional
 * kinds are absent for a different reason — a font is not a thing you wear, it is a thing you
 * choose on the axis of something you do.
 */
const kinds = computed(() => cosmetics.wearableKinds);

async function run(action: () => Promise<CosmeticError | null>): Promise<boolean> {
  if (busy.value) {
    return false;
  }

  busy.value = true;

  try {
    const refusal = await action();

    if (refusal === null) {
      return true;
    }

    toast({ title: t("error"), description: t(cosmeticErrorKey(refusal)), variant: "destructive" });

    return false;
  } catch (error) {
    logger.warn("A wardrobe change did not reach the server", error);
    toast({ title: t("error"), description: t("cosmetic_error_network"), variant: "destructive" });

    return false;
  } finally {
    busy.value = false;
  }
}

function upsell(): void {
  editing.value = null;
  emit("upsell");
}
</script>

<template>
  <div v-if="kinds.length" class="setting-card">
    <div class="flex items-center gap-2 mb-1">
      <IconStar class="w-5 h-5 text-primary" />
      <h3 class="text-lg font-semibold">{{ t("cosmetic_wardrobe") }}</h3>
    </div>
    <p class="text-xs text-muted-foreground mb-5">{{ t("cosmetic_wardrobe_hint") }}</p>

    <div class="space-y-5">
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
          <CosmeticRowPreview :kind="kind" :profile="meProfile" />

          <span class="worn-text">
            <span class="worn-label">{{ t(kind.labelKey) }}</span>
            <span class="worn-value">{{ wornLabel(kind.key) }}</span>
          </span>
          <IconChevronRight class="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <CosmeticPickerDialog
        v-if="openKind"
        :open="editing !== null"
        :kind="openKind"
        :profile="meProfile"
        :items="cosmetics.optionsFor(openKind.key)"
        :busy="busy"
        :can-upsell="canUpsell"
        @update:open="editing = $event ? editing : null"
        @apply="applyKind"
        @upsell="upsell"
      />
    </div>
  </div>
</template>

<style scoped>
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

.worn-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.worn-label,
.worn-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.worn-label {
  font-size: 0.82rem;
}

.worn-value {
  font-size: 0.76rem;
  color: hsl(var(--muted-foreground));
}
</style>
