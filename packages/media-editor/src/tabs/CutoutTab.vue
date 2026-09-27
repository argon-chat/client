<template>
  <div class="p-4 flex flex-col gap-6">
    <!-- Background -->
    <section>
      <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 px-2">{{ t('expression_workbench_background') }}</div>

      <template v-if="backgroundRemover">
        <div v-if="removal.status === 'running'" class="px-2" data-bg-removal="running">
          <div class="flex items-center justify-between text-sm mb-2">
            <span>{{ t('expression_workbench_removing') }}</span>
            <span class="tabular-nums text-muted-foreground">{{ Math.round(removal.progress * 100) }}%</span>
          </div>
          <div class="h-1 rounded-sm bg-muted-foreground/15 overflow-hidden">
            <div class="h-full bg-primary transition-[width] duration-150" :style="{ width: `${Math.round(removal.progress * 100)}%` }" />
          </div>
          <button
            class="mt-3 text-xs text-muted-foreground hover:text-foreground bg-muted px-2.5 py-1 rounded cursor-pointer border-none"
            @click="store.cancelBackgroundRemoval()"
          >{{ t('expression_workbench_cancel') }}</button>
        </div>
        <button
          v-else
          class="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-lg border-none text-sm cursor-pointer transition-colors duration-150 bg-transparent text-foreground hover:bg-accent/50 disabled:opacity-30 disabled:cursor-default"
          :disabled="!store.uiState.isReady"
          data-remove-background
          @click="removeBackground"
        >
          <div class="size-8 rounded-lg flex items-center justify-center shrink-0 bg-primary/15 text-primary">
            <Wand2 :size="20" />
          </div>
          <span class="text-left">{{ t(hasCutout ? 'expression_workbench_remove_background_again' : 'expression_workbench_remove_background') }}</span>
        </button>
        <p v-if="removal.status === 'failed'" class="px-2 mt-2 text-xs text-destructive">{{ t('expression_workbench_remove_background_failed') }}</p>
      </template>

      <button
        class="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-lg border-none text-sm cursor-pointer transition-colors duration-150 bg-transparent text-foreground hover:bg-accent/50"
        @click="refineWithBrush"
      >
        <div class="size-8 rounded-lg flex items-center justify-center shrink-0 bg-muted">
          <Scissors :size="20" />
        </div>
        <span class="text-left">{{ t('expression_workbench_refine') }}</span>
      </button>

      <button
        v-if="hasMask"
        class="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-lg border-none text-sm cursor-pointer transition-colors duration-150 bg-transparent text-foreground hover:bg-accent/50"
        data-reset-mask
        @click="store.resetMask()"
      >
        <div class="size-8 rounded-lg flex items-center justify-center shrink-0 bg-muted">
          <RotateCcw :size="20" />
        </div>
        <span class="text-left">{{ t('expression_workbench_reset_mask') }}</span>
      </button>

      <div v-if="hasCutout" class="px-2 mt-3">
        <div class="flex items-center justify-between mb-2 text-sm font-medium">
          <span>{{ t('expression_workbench_soft_edges') }}</span>
          <span class="text-muted-foreground tabular-nums" :class="{ '!text-primary': store.mediaState.mask.feather > 0 }">{{ store.mediaState.mask.feather }}</span>
        </div>
        <RangeInput
          :model-value="store.mediaState.mask.feather / MAX_FEATHER"
          :min="0" :max="1" compact
          @update:model-value="store.setMaskFeather($event * MAX_FEATHER)"
        />
      </div>
    </section>

    <!-- Outline -->
    <section>
      <div class="flex items-center justify-between mb-3 px-2">
        <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">{{ t('expression_workbench_outline') }}</span>
        <button
          role="switch"
          :aria-checked="outline.enabled"
          :aria-label="t('expression_workbench_outline')"
          class="relative w-9 h-5 rounded-full border-none cursor-pointer transition-colors"
          :class="outline.enabled ? 'bg-primary' : 'bg-muted-foreground/30'"
          data-outline-toggle
          @click="store.setOutline('enabled', !outline.enabled)"
        >
          <span class="absolute top-0.5 left-0.5 size-4 rounded-full bg-background transition-transform" :class="{ 'translate-x-4': outline.enabled }" />
        </button>
      </div>

      <div class="transition-opacity" :class="{ 'opacity-30 pointer-events-none': !outline.enabled }">
        <div class="px-2">
          <div class="flex items-center justify-between mb-2 text-sm font-medium">
            <span>{{ t('expression_workbench_outline_width') }}</span>
            <span class="text-muted-foreground tabular-nums" :class="{ '!text-primary': outline.enabled }">{{ outline.radius }} px</span>
          </div>
          <RangeInput
            :model-value="outline.radius / OUTLINE_MAX_RADIUS"
            :min="0" :max="1" compact
            @update:model-value="store.setOutline('radius', $event * OUTLINE_MAX_RADIUS)"
          />
        </div>

        <div class="flex flex-wrap gap-2 mt-4 px-2">
          <button
            v-for="color in OUTLINE_COLORS"
            :key="color"
            class="size-8 rounded-full border-2 cursor-pointer transition-transform duration-100"
            :class="outline.color === color ? 'border-primary scale-110' : 'border-muted-foreground/30 hover:scale-110'"
            :style="{ backgroundColor: color }"
            :aria-label="color"
            @click="store.setOutline('color', color)"
          />
          <label
            class="size-8 rounded-full border-2 border-dashed border-muted-foreground/50 cursor-pointer flex items-center justify-center transition-transform hover:scale-110 text-muted-foreground hover:text-foreground overflow-hidden relative"
            :title="t('expression_workbench_outline_custom')"
          >
            <Pipette :size="14" />
            <input type="color" class="absolute inset-0 opacity-0 cursor-pointer" :value="outline.color" @change="onCustomColor" />
          </label>
        </div>
      </div>
    </section>

    <p class="px-2 text-xs text-muted-foreground">{{ exportNote }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Wand2, Scissors, RotateCcw, Pipette } from 'lucide-vue-next';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import RangeInput from '../components/RangeInput.vue';
import { OUTLINE_MAX_RADIUS } from '../mask/maskMath';
import { EXPRESSION_EXPORT_PRESETS } from '../finalRender/computeExportDimensions';

const { t } = useI18n();
const { store, mode, backgroundRemover } = useMediaEditorContext();

const MAX_FEATHER = 12;
const OUTLINE_COLORS = ['#ffffff', '#000000', '#fe4438', '#ffd60a', '#33c759', '#0a84ff', '#bd5cf3'];

const outline = computed(() => store.mediaState.outline);
const removal = computed(() => store.uiState.backgroundRemoval);
const hasCutout = computed(() => store.getMaskSource(store.mediaState.mask.source) !== null);
const hasMask = computed(() => store.mediaState.mask.source !== null || store.mediaState.mask.strokes.length > 0);

const exportNote = computed(() => {
  const box = mode === 'emoji' ? EXPRESSION_EXPORT_PRESETS.emoji.box : EXPRESSION_EXPORT_PRESETS.sticker.box;
  return t(mode === 'emoji' ? 'expression_workbench_export_emoji' : 'expression_workbench_export_sticker', { size: box });
});

function removeBackground() {
  const image = store.uiState.renderingPayload?.media.image;
  if (!backgroundRemover || !image) return;
  void store.removeBackground(backgroundRemover, image);
}

function refineWithBrush() {
  store.uiState.currentBrush.brush = 'maskErase';
  store.uiState.currentTab = 'brush';
}

function onCustomColor(e: Event) {
  store.setOutline('color', (e.target as HTMLInputElement).value);
}
</script>
