<template>
  <div class="p-4">
    <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 px-2">{{ t('media_editor_curves') }}</div>

    <!-- Channel selector -->
    <div class="flex gap-1 mb-4 px-2">
      <button
        v-for="ch in channels"
        :key="ch.id"
        class="flex-1 py-1.5 rounded-md text-xs font-bold border transition-all"
        :class="activeChannel === ch.id
          ? `border-current ${ch.activeClass}`
          : 'border-border text-muted-foreground hover:border-foreground/30'"
        @click="activeChannel = ch.id"
      >{{ ch.label }}</button>
    </div>

    <!-- Curve controls -->
    <div class="space-y-3">
      <div class="px-2">
        <label class="text-[11px] text-muted-foreground block mb-1">{{ t('media_editor_shadows') }}</label>
        <RangeInput
          :model-value="currentValues[0]"
          :min="-1"
          :max="1"
          @update:model-value="v => setChannel(0, v)"
        />
      </div>
      <div class="px-2">
        <label class="text-[11px] text-muted-foreground block mb-1">{{ t('media_editor_highlights') }}</label>
        <RangeInput
          :model-value="currentValues[1]"
          :min="-1"
          :max="1"
          @update:model-value="v => setChannel(1, v)"
        />
      </div>
    </div>

    <!-- Selective Color -->
    <div class="mt-6">
      <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 px-2">{{ t('media_editor_selective_color') }}</div>
      <div class="space-y-3 px-2">
        <div>
          <label class="text-[11px] text-muted-foreground block mb-1">{{ t('media_editor_target_hue') }}</label>
          <div class="relative h-6 rounded-md overflow-hidden cursor-pointer" @click="pickHue">
            <div class="absolute inset-0" style="background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" />
            <div
              class="absolute top-0 bottom-0 w-1 bg-white border border-black/30 rounded-sm -translate-x-1/2"
              :style="{ left: (store.mediaState.selective.hue * 100) + '%' }"
            />
          </div>
        </div>
        <div>
          <label class="text-[11px] text-muted-foreground block mb-1">{{ t('media_editor_range') }}</label>
          <RangeInput
            :model-value="store.mediaState.selective.range"
            :min="0"
            :max="1"
            @update:model-value="v => store.mediaState.selective.range = v"
          />
        </div>
        <div>
          <label class="text-[11px] text-muted-foreground block mb-1">{{ t('media_editor_hue_shift') }}</label>
          <RangeInput
            :model-value="store.mediaState.selective.shift"
            :min="-1"
            :max="1"
            @update:model-value="v => store.mediaState.selective.shift = v"
          />
        </div>
        <div>
          <label class="text-[11px] text-muted-foreground block mb-1">{{ t('media_editor_saturation') }}</label>
          <RangeInput
            :model-value="store.mediaState.selective.sat"
            :min="-1"
            :max="1"
            @update:model-value="v => store.mediaState.selective.sat = v"
          />
        </div>
        <div>
          <label class="text-[11px] text-muted-foreground block mb-1">{{ t('media_editor_luminance') }}</label>
          <RangeInput
            :model-value="store.mediaState.selective.luma"
            :min="-1"
            :max="1"
            @update:model-value="v => store.mediaState.selective.luma = v"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import RangeInput from '../components/RangeInput.vue';

const { t } = useI18n();
const { store } = useMediaEditorContext();

type Channel = 'r' | 'g' | 'b';
const activeChannel = ref<Channel>('r');

const channels = [
  { id: 'r' as const, label: 'R', activeClass: 'text-red-500 bg-red-500/10' },
  { id: 'g' as const, label: 'G', activeClass: 'text-green-500 bg-green-500/10' },
  { id: 'b' as const, label: 'B', activeClass: 'text-blue-500 bg-blue-500/10' },
];

const currentValues = computed(() => store.mediaState.curves[activeChannel.value]);

function setChannel(index: 0 | 1, value: number) {
  const ch = activeChannel.value;
  const arr = [...store.mediaState.curves[ch]] as [number, number];
  arr[index] = value;
  store.mediaState.curves[ch] = arr;
}

function pickHue(e: MouseEvent) {
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  store.mediaState.selective.hue = Math.max(0, Math.min(1, x));
}
</script>
