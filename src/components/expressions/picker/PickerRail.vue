<script setup lang="ts">
import "./pickerScroll.css";
import { computed, nextTick, ref, watch, type Component } from "vue";
import {
  AppleIcon,
  CarIcon,
  ClockIcon,
  FlagIcon,
  HandIcon,
  HeartIcon,
  LightbulbIcon,
  PawPrintIcon,
  PlusIcon,
  SmileIcon,
  TrophyIcon,
} from "lucide-vue-next";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import StickerView from "@/components/expressions/StickerView.vue";
import { pickerMedia } from "./pickerMedia";
import { initialOf as initials, type RailEntry, type UnicodeGroup } from "./pickerModel";

/**
 * The column beside the grid: recent, the spaces (and on the sticker tab each space's pack covers),
 * the unicode groups. One tab stop; arrows move along it. Follows the grid's scroll.
 */
const props = defineProps<{
  entries: readonly RailEntry[];
  /** The grid's current group. */
  active: string | null;
  label: string;
  /** Offers the space's expression settings, at the end of the spaces. */
  manageLabel?: string | null;
}>();

const emit = defineEmits<{ select: [target: string]; manage: [] }>();

const GROUP_ICONS: Record<UnicodeGroup, Component> = {
  smileys: SmileIcon,
  people: HandIcon,
  animals: PawPrintIcon,
  food: AppleIcon,
  travel: CarIcon,
  activities: TrophyIcon,
  objects: LightbulbIcon,
  symbols: HeartIcon,
  flags: FlagIcon,
};

const rail = ref<HTMLElement | null>(null);
const focusedId = ref<string | null>(null);

const isActive = (entry: RailEntry) => !!props.active && entry.within.includes(props.active);

type Row = { key: string; divider: boolean } & ({ type: "entry"; entry: RailEntry } | { type: "manage" });

/** The entries with a divider between blocks, and the manage button after the spaces. */
const rows = computed(() => {
  const out: Row[] = [];
  let block: string | null = null;
  const manage = () => {
    out.push({ key: "manage", type: "manage", divider: block === "recent" });
    block = "manage";
  };
  for (const entry of props.entries) {
    if (props.manageLabel && entry.type === "unicode" && block !== "unicode") manage();
    out.push({ key: entry.id, type: "entry", entry, divider: block !== null && entry.block !== block });
    block = entry.block;
  }
  if (props.manageLabel && !out.some((r) => r.type === "manage")) manage();
  return out;
});

const tabStop = computed(() => {
  const ids = props.entries.map((e) => e.id);
  if (focusedId.value && ids.includes(focusedId.value)) return focusedId.value;
  return props.entries.find((e) => isActive(e) && e.type !== "space")?.id ?? props.entries.find(isActive)?.id ?? ids[0] ?? null;
});

const buttons = () => [...(rail.value?.querySelectorAll<HTMLElement>(".xp-rail__item") ?? [])];

function onKeydown(e: KeyboardEvent) {
  const keys = ["ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const all = buttons();
  if (!all.length) return;
  const at = all.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : Math.min(all.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
  all[next]?.focus();
}

function onFocusIn(e: FocusEvent) {
  const id = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-rail]")?.dataset.rail;
  if (id && id !== "manage") focusedId.value = id;
}

// Tabbing back in lands on the current entry again, not where the focus last was.
function onFocusOut(e: FocusEvent) {
  if (!rail.value?.contains(e.relatedTarget as Node | null)) focusedId.value = null;
}

// Keeps the current entry in view as the grid scrolls, without moving anything but the rail.
watch(
  () => props.active,
  async () => {
    await nextTick();
    const box = rail.value;
    const entry = props.entries.find((e) => isActive(e) && e.type !== "space") ?? props.entries.find(isActive);
    const button = entry ? box?.querySelector<HTMLElement>(`[data-rail="${CSS.escape(entry.id)}"]`) : null;
    if (!box || !button) return;
    const top = button.offsetTop;
    const bottom = top + button.offsetHeight;
    if (top < box.scrollTop) box.scrollTo({ top: top - 4, behavior: "smooth" });
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTo({ top: bottom - box.clientHeight + 4, behavior: "smooth" });
  },
);
</script>

<template>
  <nav
    ref="rail"
    class="xp-rail xp-scroll xp-scroll--rail"
    :aria-label="label"
    @keydown="onKeydown"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <template v-for="row in rows" :key="row.key">
      <div v-if="row.divider" class="xp-rail__divider" aria-hidden="true" />
      <button
        v-if="row.type === 'manage'"
        type="button"
        class="xp-rail__item xp-rail__item--manage"
        data-rail="manage"
        :title="manageLabel ?? undefined"
        :aria-label="manageLabel ?? undefined"
        tabindex="-1"
        @click="emit('manage')"
      >
        <PlusIcon class="xp-rail__icon" />
      </button>
      <button
        v-else
        type="button"
        class="xp-rail__item"
        :class="[`xp-rail__item--${row.entry.type}`, { 'is-active': isActive(row.entry) }]"
        :data-rail="row.entry.id"
        :title="row.entry.label"
        :aria-label="row.entry.label"
        :aria-current="isActive(row.entry) ? 'true' : undefined"
        :tabindex="row.entry.id === tabStop ? 0 : -1"
        @click="emit('select', row.entry.target)"
      >
        <ClockIcon v-if="row.entry.type === 'recent'" class="xp-rail__icon" />
        <component :is="GROUP_ICONS[row.entry.group]" v-else-if="row.entry.type === 'unicode'" class="xp-rail__icon" />
        <ArgonAvatar
          v-else-if="row.entry.type === 'space'"
          class="xp-rail__avatar"
          :file-id="row.entry.space.avatarFileId"
          :space-id="row.entry.space.spaceId"
          :fallback="initials(row.entry.space.name)"
        />
        <StickerView
          v-else-if="row.entry.cover"
          :media="pickerMedia(row.entry.cover)"
          :size="32"
          :autoplay="false"
          group="picker"
        />
        <span v-else class="xp-rail__letter">{{ initials(row.entry.label) }}</span>
      </button>
    </template>
  </nav>
</template>

<style scoped>
.xp-rail {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 48px;
  flex: none;
  padding: 6px 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-right: 1px solid hsl(var(--border) / 0.6);
  background: hsl(var(--muted) / 0.35);
}

.xp-rail__item {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: calc(var(--radius) - 2px);
  color: hsl(var(--muted-foreground));
  transition: background-color 0.12s ease, color 0.12s ease;
}

.xp-rail__item:hover {
  background: hsl(var(--accent) / 0.6);
  color: hsl(var(--foreground));
}

.xp-rail__item.is-active {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.xp-rail__item--space.is-active {
  background: transparent;
  box-shadow: inset 0 0 0 2px hsl(var(--primary) / 0.7);
}

.xp-rail__item:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: -2px;
}

.xp-rail__icon {
  width: 20px;
  height: 20px;
}

.xp-rail__avatar {
  width: 32px;
  height: 32px;
  font-size: 0.8rem;
  pointer-events: none;
}

.xp-rail__item :deep(.sticker-view) {
  pointer-events: none;
}

.xp-rail__letter {
  font-size: 0.9rem;
  font-weight: 600;
}

.xp-rail__divider {
  flex: none;
  width: 24px;
  height: 1px;
  margin: 3px 0;
  background: hsl(var(--border));
}
</style>
