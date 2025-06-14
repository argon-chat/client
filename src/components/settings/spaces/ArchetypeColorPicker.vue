<script setup lang="ts">
import { ref, watch, computed } from "vue";

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
  return `#${rgb.toString(16).padStart(6, "0")}`;
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
  <div class="space-y-1">
    <label class="text-sm font-medium text-white">Role Color</label>
    <p class="text-xs text-muted">Members use the colour of the highest role they have on the roles list.</p>

    <div class="flex items-center gap-2 mt-2">
      <div
        class="w-10 h-10 rounded-md border border-white/20"
        :style="{ backgroundColor: displayColor }"
      />
      <button
        type="button"
        :disabled="readonly"
        :class="[
          'w-10 h-10 flex items-center justify-center rounded-md border transition',
          'border-white/20 hover:border-white',
          readonly ? 'cursor-not-allowed opacity-50' : ''
        ]"
        @click="openColorPicker"
        title="Custom color"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
          <path
            d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828zM5 15v-1.586l7.586-7.586L14.586 7 7 14.586H5z" />
        </svg>
      </button>
      <input
        ref="colorPicker"
        type="color"
        class="absolute opacity-0 w-0 h-0 pointer-events-none"
        :disabled="readonly"
        :value="displayColor"
        @change="handleCustomColorChange"
      />
    </div>

    <div class="flex flex-wrap gap-2 mt-3">
      <button
        class="w-8 h-8 rounded-md border-2"
        :disabled="readonly"
        :class="[
          modelValue === null ? 'border-blue-500' : 'border-transparent',
          readonly ? 'cursor-not-allowed opacity-50' : ''
        ]"
        @click="selectColor(null)"
      >
        <div class="w-full h-full bg-gray-400 rounded-md" />
      </button>

      <button
        v-for="color in colors"
        :key="color"
        type="button"
        :disabled="readonly"
        class="w-8 h-8 rounded-md border-2"
        :style="{ backgroundColor: color }"
        :class="[
          modelValue !== null && argbToHex(modelValue) === color ? 'border-blue-500' : 'border-transparent',
          readonly ? 'cursor-not-allowed opacity-50' : ''
        ]"
        @click="selectColor(color)"
      />
    </div>
  </div>
</template>

<style scoped>
.text-muted {
  color: theme('colors.gray.400');
}
</style>
