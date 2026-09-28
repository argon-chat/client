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

    <!-- Selection and smart erasers -->
    <section data-cutout-tools>
      <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 px-2">{{ t('media_editor_cutout_tools') }}</div>
      <div class="grid grid-cols-4 gap-1">
        <button
          v-for="item in TOOLS"
          :key="item.id"
          class="flex flex-col items-center gap-1.5 px-1 py-2 rounded-lg border-none text-xs cursor-pointer transition-colors duration-150 disabled:opacity-30 disabled:cursor-default"
          :class="tool === item.id ? 'bg-accent text-foreground' : 'bg-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground'"
          :aria-pressed="tool === item.id"
          :disabled="!store.uiState.isReady"
          :data-cutout-tool="item.id"
          @click="selectTool(item.id)"
        >
          <div class="size-8 rounded-lg flex items-center justify-center shrink-0" :class="tool === item.id ? 'bg-primary/15 text-primary' : 'bg-muted'">
            <component :is="item.icon" :size="18" />
          </div>
          <span class="leading-tight text-center">{{ t(item.labelKey) }}</span>
        </button>
      </div>

      <div v-if="tool" class="mt-4 flex flex-col gap-4" data-cutout-options>
        <div v-if="tool === 'lasso'" class="px-2">
          <Segmented
            :options="[{ value: 'freehand', label: t('media_editor_lasso_freehand') }, { value: 'polygon', label: t('media_editor_lasso_polygon') }]"
            :model-value="options.lassoMode"
            data-option="lasso-mode"
            @update:model-value="options.lassoMode = $event as 'freehand' | 'polygon'"
          />
        </div>

        <template v-if="tool === 'magneticLasso'">
          <OptionSlider v-model="options.edgeWidth" :label="t('media_editor_edge_width')" :min="1" :max="256" unit=" px" data-option="edge-width" />
          <OptionSlider v-model="options.edgeContrast" :label="t('media_editor_edge_contrast')" :min="1" :max="100" unit="%" data-option="edge-contrast" />
          <OptionSlider v-model="options.frequency" :label="t('media_editor_frequency')" :max="100" data-option="frequency" />
        </template>
        <template v-if="isLassoTool">
          <OptionSlider v-model="options.selectionFeather" :label="t('media_editor_feather')" :max="SELECTION_MAX_FEATHER" unit=" px" data-option="feather" />
          <SwitchRow v-model="options.selectionAntiAlias" :label="t('media_editor_anti_alias')" data-option="selection-anti-alias" />
        </template>

        <template v-if="tool === 'magicEraser'">
          <OptionSlider v-model="options.magicTolerance" :label="t('media_editor_tolerance')" :max="255" data-option="tolerance" />
          <SwitchRow v-model="options.magicAntiAlias" :label="t('media_editor_anti_alias')" data-option="anti-alias" />
          <SwitchRow v-model="options.contiguous" :label="t('media_editor_contiguous')" data-option="contiguous" />
          <OptionSlider v-model="options.magicOpacity" :label="t('media_editor_opacity')" :max="100" unit="%" data-option="opacity" />
          <div class="px-2">
            <div class="mb-2 text-sm font-medium">{{ t('media_editor_sample_size') }}</div>
            <Segmented
              :options="sampleSizes"
              :model-value="String(options.sampleSize)"
              data-option="sample-size"
              @update:model-value="options.sampleSize = Number($event)"
            />
          </div>
        </template>

        <template v-if="tool === 'backgroundEraser'">
          <OptionSlider v-model="options.eraserSize" :label="t('media_editor_size')" :min="8" :max="200" unit=" px" data-option="eraser-size" />
          <OptionSlider v-model="options.eraserHardness" :label="t('media_editor_hardness')" :max="100" unit="%" data-option="hardness" />
          <OptionSlider v-model="options.eraserSpacing" :label="t('media_editor_spacing')" :min="1" :max="100" unit="%" data-option="spacing" />
          <OptionSlider v-model="options.eraserTolerance" :label="t('media_editor_tolerance')" :max="100" unit="%" data-option="eraser-tolerance" />
          <div class="px-2">
            <div class="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
              <span>{{ t('media_editor_sampling') }}</span>
              <ColourOption
                v-if="options.sampling === 'swatch'"
                v-model="options.swatch"
                :label="t('media_editor_sampling_swatch')"
                :pick-label="t('media_editor_pick_colour')"
                :picking="store.uiState.pickColour === 'swatch'"
                data-option="swatch"
                @pick="togglePick('swatch')"
              />
            </div>
            <Segmented
              :options="samplings"
              :model-value="options.sampling"
              data-option="sampling"
              @update:model-value="options.sampling = $event as EraserSampling"
            />
          </div>
          <div class="px-2">
            <div class="mb-2 text-sm font-medium">{{ t('media_editor_limits') }}</div>
            <Segmented
              :options="limits"
              :model-value="options.limits"
              data-option="limits"
              @update:model-value="options.limits = $event as EraserLimits"
            />
          </div>
          <SwitchRow v-model="options.protectForeground" :label="t('media_editor_protect_foreground')" data-option="protect-foreground">
            <ColourOption
              v-model="options.foreground"
              :label="t('media_editor_protect_foreground')"
              :pick-label="t('media_editor_pick_colour')"
              :picking="store.uiState.pickColour === 'foreground'"
              data-option="foreground"
              @pick="togglePick('foreground')"
            />
          </SwitchRow>
        </template>

        <div v-if="isLassoTool && store.uiState.selection" class="px-2 flex gap-2" data-selection-actions>
          <button
            class="flex-1 py-2 px-2 rounded-md text-xs font-medium border cursor-pointer transition-all border-primary text-primary bg-primary/10 hover:bg-primary/20"
            data-selection-action="keep"
            @click="store.applySelection('keep')"
          >{{ t('media_editor_keep_inside') }}</button>
          <button
            class="flex-1 py-2 px-2 rounded-md text-xs font-medium border cursor-pointer transition-all border-border text-foreground bg-transparent hover:border-foreground/30"
            data-selection-action="erase"
            @click="store.applySelection('erase')"
          >{{ t('media_editor_erase_inside') }}</button>
          <button
            class="flex-1 py-2 px-2 rounded-md text-xs font-medium border cursor-pointer transition-all"
            :class="store.uiState.selection?.inverted ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground bg-transparent hover:border-foreground/30'"
            :aria-pressed="!!store.uiState.selection?.inverted"
            data-selection-action="invert"
            @click="toggleInvert"
          >{{ t('media_editor_invert_selection') }}</button>
        </div>

        <p v-if="edgeStatus" class="px-2 text-xs" :class="store.uiState.liveWire === 'failed' ? 'text-destructive' : 'text-muted-foreground'" data-edge-status>{{ edgeStatus }}</p>
        <p class="px-2 text-xs text-muted-foreground">{{ hint }}</p>
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
import { computed, type Component } from 'vue';
import { useI18n } from 'vue-i18n';
import { Wand2, Scissors, RotateCcw, Pipette, Lasso, Magnet, Wand, Eraser } from 'lucide-vue-next';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import RangeInput from '../components/RangeInput.vue';
import OptionSlider from '../components/OptionSlider.vue';
import Segmented from '../components/Segmented.vue';
import SwitchRow from '../components/SwitchRow.vue';
import ColourOption from '../components/ColourOption.vue';
import type { EraserLimits, EraserSampling } from '../selection/backgroundEraser';
import { OUTLINE_MAX_RADIUS } from '../mask/maskMath';
import { EXPRESSION_EXPORT_PRESETS } from '../finalRender/computeExportDimensions';
import { SELECTION_MAX_FEATHER } from '../store/editorStore';
import type { CutoutTool } from '../types';

const { t } = useI18n();
const { store, mode, backgroundRemover } = useMediaEditorContext();

const TOOLS: { id: CutoutTool; labelKey: string; icon: Component }[] = [
  { id: 'lasso', labelKey: 'media_editor_tool_lasso', icon: Lasso },
  { id: 'magneticLasso', labelKey: 'media_editor_tool_magnetic_lasso', icon: Magnet },
  { id: 'magicEraser', labelKey: 'media_editor_tool_magic_eraser', icon: Wand },
  { id: 'backgroundEraser', labelKey: 'media_editor_tool_background_eraser', icon: Eraser }
];

const tool = computed(() => store.uiState.cutoutTool);
const options = computed(() => store.uiState.cutoutOptions);
const isLassoTool = computed(() => tool.value === 'lasso' || tool.value === 'magneticLasso');

function toggleInvert() {
  const selection = store.uiState.selection;
  if (selection) selection.inverted = !selection.inverted;
}

function selectTool(id: CutoutTool) {
  store.uiState.cutoutTool = store.uiState.cutoutTool === id ? null : id;
}

const sampleSizes = computed(() => [
  { value: '1', label: t('media_editor_sample_point') },
  { value: '3', label: '3×3' },
  { value: '5', label: '5×5' },
  { value: '11', label: '11×11' }
]);

const samplings = computed(() => [
  { value: 'continuous', label: t('media_editor_sampling_continuous') },
  { value: 'once', label: t('media_editor_sampling_once') },
  { value: 'swatch', label: t('media_editor_sampling_swatch') }
]);

const limits = computed(() => [
  { value: 'discontiguous', label: t('media_editor_limits_discontiguous') },
  { value: 'contiguous', label: t('media_editor_limits_contiguous') },
  { value: 'findEdges', label: t('media_editor_limits_find_edges') }
]);

/** The next click on the image picks the colour (again: stop picking). */
function togglePick(which: 'swatch' | 'foreground') {
  store.uiState.pickColour = store.uiState.pickColour === which ? null : which;
}

const edgeStatus = computed(() => {
  if (tool.value !== 'magneticLasso') return '';
  if (store.uiState.liveWire === 'preparing') return t('media_editor_edges_preparing');
  if (store.uiState.liveWire === 'failed') return t('media_editor_edges_failed');
  return '';
});

const hint = computed(() => {
  if (store.uiState.pickColour) return t('media_editor_hint_pick_colour');
  if (isLassoTool.value && store.uiState.selection) return t('media_editor_hint_selection');
  switch (tool.value) {
    case 'lasso':
      return t(options.value.lassoMode === 'polygon' ? 'media_editor_hint_lasso_polygon' : 'media_editor_hint_lasso_freehand');
    case 'magneticLasso':
      return t(store.uiState.liveWire === 'failed' ? 'media_editor_hint_lasso_polygon' : 'media_editor_hint_magnetic_lasso');
    case 'magicEraser':
      return t('media_editor_hint_magic_eraser');
    case 'backgroundEraser':
      return t('media_editor_hint_background_eraser');
    default:
      return '';
  }
});

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
