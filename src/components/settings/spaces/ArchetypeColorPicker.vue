<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useLocale } from "@/store/system/localeStore";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@argon/ui/tooltip";
import { PipetteIcon } from "lucide-vue-next";

const { t } = useLocale();
const props = defineProps<{
  modelValue: number | null;
  readonly?: boolean;
}>();

const emit =
  defineEmits<(e: "update:modelValue", value: number | null) => void>();

function hexToArgb(hex: string): number {
  const rgb = Number.parseInt(hex.slice(1), 16);
  return 0xff000000 | rgb;
}

function argbToHex(argb: number): string {
  const rgb = argb & 0xffffff;
  return `#${rgb.toString(16).padStart(6, "0").toUpperCase()}`;
}

const colors = [
  "#5865F2",
  "#57F287",
  "#FEE75C",
  "#EB459E",
  "#ED4245",
  "#FAA61A",
  "#1ABC9C",
  "#2ECC71",
  "#3498DB",
  "#9B59B6",
  "#E67E22",
  "#E74C3C",
  "#95A5A6",
  "#99AAB5",
  "#2C2F33",
  "#23272A",
  "#A3BE8C",
  "#88C0D0",
  "#D08770",
  "#B48EAD",
  "#D8DEE9",
  "#BF616A",
  "#EBCB8B",
  "#5E81AC",
  "#6C757D",
  "#ADB5BD",
  "#495057",
  "#343A40",
  "#FFFFFF",
  "#000000",
  "#808080",
  "#666666",
];

const colorPicker = ref<HTMLInputElement | null>(null);
const customColor = ref<string | null>(null);

watch(
  () => props.modelValue,
  (val) => {
    if (val != null && !colors.includes(argbToHex(val))) {
      customColor.value = argbToHex(val);
    }
  },
);

function isSelected(color: string | null): boolean {
  if (color === null) return props.modelValue === null;
  return props.modelValue !== null && argbToHex(props.modelValue) === color;
}

function selectColor(color: string | null) {
  if (props.readonly) return;
  if (!color) {
    emit("update:modelValue", null);
  } else {
    emit("update:modelValue", hexToArgb(color));
    if (!colors.includes(color)) {
      customColor.value = color;
    }
  }
}

function openColorPicker() {
  if (!props.readonly) {
    colorPicker.value?.click();
  }
}

function handleCustomColorChange(event: Event) {
  const input = event.target as HTMLInputElement;
  selectColor(input.value);
}

const displayColor = computed(() =>
  props.modelValue != null ? argbToHex(props.modelValue) : "#99AAB5",
);
</script>

<template>
  <div class="space-y-2">
    <label class="text-sm font-medium text-white">{{ t("role_color") }}</label>
    <p class="text-xs text-muted-foreground">{{ t("role_color_explain") }}.</p>

    <div class="flex items-center gap-3 mt-2">
      <div class="w-10 h-10 rounded-lg border border-white/10 shadow-sm"
        :style="{ backgroundColor: displayColor }" />
      <button type="button" :disabled="readonly" :class="[
        'w-10 h-10 flex items-center justify-center rounded-lg border transition-all duration-150',
        'border-white/10 hover:border-white/40 hover:bg-white/5',
        readonly ? 'cursor-not-allowed opacity-50' : ''
      ]" @click="openColorPicker" :title="t('role_color') || 'Custom color'">
        <PipetteIcon class="w-4 h-4 text-white/70" />
      </button>
      <span class="text-xs text-muted-foreground font-mono">{{ displayColor }}</span>
      <input ref="colorPicker" type="color" class="absolute opacity-0 w-0 h-0 pointer-events-none"
        :disabled="readonly" :value="displayColor" @change="handleCustomColorChange" />
    </div>

    <TooltipProvider :delay-duration="200">
      <div class="flex flex-wrap gap-1.5 mt-3">
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="color-swatch" :disabled="readonly" :class="[
              isSelected(null) ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-background' : '',
              readonly ? 'cursor-not-allowed opacity-50' : ''
            ]" @click="selectColor(null)">
              <div class="w-full h-full bg-gray-400 rounded" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" :side-offset="4">
            <p class="text-xs">Default</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip v-for="color in colors" :key="color">
          <TooltipTrigger as-child>
            <button type="button" :disabled="readonly"
              class="color-swatch" :style="{ backgroundColor: color }" :class="[
                isSelected(color) ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-background' : '',
                readonly ? 'cursor-not-allowed opacity-50' : ''
              ]" @click="selectColor(color)" />
          </TooltipTrigger>
          <TooltipContent side="top" :side-offset="4">
            <p class="text-xs font-mono">{{ color }}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  </div>
</template>

<style scoped>
.color-swatch {
  @apply w-7 h-7 rounded transition-all duration-150 cursor-pointer;
  @apply hover:scale-110 hover:shadow-md;
}
</style>
