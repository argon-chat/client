<script setup lang="ts">
import { nextTick, ref, watch, type Component } from "vue";
import {
  AppleIcon,
  CarIcon,
  ClockIcon,
  FlagIcon,
  HandIcon,
  HeartIcon,
  LightbulbIcon,
  PawPrintIcon,
  SearchIcon,
  SmileIcon,
  TrophyIcon,
} from "lucide-vue-next";
import StickerView from "@/components/expressions/StickerView.vue";
import { toMedia } from "@/store/data/expressionsStore";
import type { PickerSectionData, UnicodeGroup } from "./pickerModel";

/** The strip of section buttons above the grid: unicode group icons and pack covers (32 px). */
const props = defineProps<{
  sections: readonly PickerSectionData[];
  active: string | null;
}>();

const emit = defineEmits<{ select: [id: string] }>();

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

const bar = ref<HTMLElement | null>(null);

// Keeps the current button in view as the grid scrolls, without moving anything but the strip.
watch(
  () => props.active,
  async (id) => {
    await nextTick();
    const strip = bar.value;
    const button = id ? strip?.querySelector<HTMLElement>(`[data-section="${CSS.escape(id)}"]`) : null;
    if (!strip || !button) return;
    const left = button.offsetLeft;
    const right = left + button.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollTo({ left: left - 4, behavior: "smooth" });
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: right - strip.clientWidth + 4, behavior: "smooth" });
  },
);
</script>

<template>
  <div ref="bar" class="xp-bar" role="toolbar">
    <button
      v-for="section in sections"
      :key="section.id"
      type="button"
      class="xp-bar__item"
      :class="{ 'is-active': section.id === active }"
      :data-section="section.id"
      :title="section.title"
      :aria-label="section.title"
      :aria-current="section.id === active ? 'true' : undefined"
      @click="emit('select', section.id)"
    >
      <ClockIcon v-if="section.icon.type === 'recent'" class="xp-bar__icon" />
      <SearchIcon v-else-if="section.icon.type === 'search'" class="xp-bar__icon" />
      <component :is="GROUP_ICONS[section.icon.group]" v-else-if="section.icon.type === 'group'" class="xp-bar__icon" />
      <StickerView
        v-else-if="section.icon.cover"
        :media="toMedia(section.icon.cover)"
        :size="32"
        :autoplay="false"
        group="picker"
      />
      <span v-else class="xp-bar__letter">{{ section.title.slice(0, 1).toUpperCase() }}</span>
    </button>
  </div>
</template>

<style scoped>
.xp-bar {
  display: flex;
  gap: 2px;
  padding: 4px 6px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  border-bottom: 1px solid hsl(var(--border));
  flex: none;
}

.xp-bar::-webkit-scrollbar {
  display: none;
}

.xp-bar__item {
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

.xp-bar__item:hover {
  background: hsl(var(--accent) / 0.6);
  color: hsl(var(--foreground));
}

.xp-bar__item.is-active {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.xp-bar__item:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: -2px;
}

.xp-bar__icon {
  width: 20px;
  height: 20px;
}

.xp-bar__letter {
  font-size: 0.9rem;
  font-weight: 600;
}
</style>
