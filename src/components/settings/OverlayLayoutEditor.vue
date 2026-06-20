<template>
  <div class="space-y-4 overlay-layout-editor">
    <!-- ── Drag preview ── -->
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="text-sm font-medium">Layout</label>
        <button class="text-xs text-muted-foreground hover:text-foreground" @click="resetAll">
          Reset to defaults
        </button>
      </div>
      <p class="text-xs text-muted-foreground">
        Drag a widget to position it over the game. Click it to edit its options.
      </p>

      <div ref="previewEl" class="preview" @pointerdown="select(null)">
        <div class="preview-grid"></div>
        <div
          v-for="w in visibleWidgets"
          :key="w.type"
          class="widget-box"
          :class="{ selected: selected === w.type }"
          :style="boxStyle(w)"
          @pointerdown.stop="startDrag(w.type, $event)"
        >
          <component :is="w.icon" class="w-3.5 h-3.5 shrink-0" />
          <span class="truncate">{{ w.label }}</span>
        </div>
      </div>
    </div>

    <!-- ── Per-widget enable + select strip ── -->
    <div class="flex flex-wrap gap-2">
      <button
        v-for="w in widgets"
        :key="w.type"
        class="chip"
        :class="{ 'chip-on': w.layout.visible, 'chip-sel': selected === w.type }"
        @click="select(w.type)"
      >
        <component :is="w.icon" class="w-4 h-4" />
        <span>{{ w.label }}</span>
        <Switch
          :checked="w.layout.visible"
          class="ml-1 scale-75"
          @click.stop="setVisible(w.type, !w.layout.visible)"
        />
      </button>
    </div>

    <!-- ── Selected widget controls ── -->
    <div v-if="selectedWidget" class="setting-sub-card space-y-4">
      <div class="font-medium text-sm flex items-center gap-2">
        <component :is="selectedWidget.icon" class="w-4 h-4" /> {{ selectedWidget.label }}
      </div>

      <!-- anchor chips -->
      <div class="space-y-1.5">
        <label class="text-xs text-muted-foreground">Anchor</label>
        <div class="anchor-grid">
          <button
            v-for="a in anchors"
            :key="a.value"
            class="anchor-cell"
            :class="{ 'anchor-on': anchorOf(selected!) === a.value }"
            :title="a.label"
            @click="setAnchor(selected!, a.value)"
          >
            <span class="dot" />
          </button>
        </div>
      </div>

      <!-- scale -->
      <div class="space-y-1.5">
        <div class="flex justify-between text-xs">
          <span>Scale</span>
          <span class="text-muted-foreground">{{ Math.round(selectedWidget.layout.scale * 100) }}%</span>
        </div>
        <Slider :min="0.5" :max="2" :step="0.05" :modelValue="[selectedWidget.layout.scale]"
          @update:modelValue="(v: number[]) => setLayout(selected!, { scale: v[0] ?? 1 })" />
      </div>

      <!-- opacity -->
      <div class="space-y-1.5">
        <div class="flex justify-between text-xs">
          <span>Opacity</span>
          <span class="text-muted-foreground">{{ Math.round(selectedWidget.layout.opacity * 100) }}%</span>
        </div>
        <Slider :min="0.2" :max="1" :step="0.05" :modelValue="[selectedWidget.layout.opacity]"
          @update:modelValue="(v: number[]) => setLayout(selected!, { opacity: v[0] ?? 1 })" />
      </div>

      <!-- voice-specific appearance -->
      <template v-if="selected === 'voice'">
        <div class="border-t border-white/10 pt-3 space-y-3">
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">Layout mode</label>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="m in voiceModes" :key="m.value" class="mode-chip"
                :class="{ 'mode-on': store.hud.voice.mode === m.value }"
                @click="store.setVoiceMode(m.value)">
                {{ m.label }}
              </button>
            </div>
          </div>
          <label class="toggle-row">
            <span>Show names</span>
            <Switch :checked="store.hud.voice.showNames"
              @update:checked="(v: boolean) => store.setVoiceAppearance({ showNames: v })" />
          </label>
          <label class="toggle-row">
            <span>Member cards</span>
            <Switch :checked="store.hud.voice.showMemberCards"
              @update:checked="(v: boolean) => store.setVoiceAppearance({ showMemberCards: v })" />
          </label>
          <label class="toggle-row">
            <span>Panel background</span>
            <Switch :checked="store.hud.voice.showWidgetBackground"
              @update:checked="(v: boolean) => store.setVoiceAppearance({ showWidgetBackground: v })" />
          </label>
          <label class="toggle-row">
            <span>Speaking meter</span>
            <Switch :checked="store.hud.voice.showVolume"
              @update:checked="(v: boolean) => store.setVoiceAppearance({ showVolume: v })" />
          </label>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Switch } from "@argon/ui/switch";
import { Slider } from "@argon/ui/slider";
import { Mic, MessageSquare, Bell } from "lucide-vue-next";
import { useGameOverlaySettings } from "@/store/features/gameOverlaySettingsStore";
import { computeAnchoredPosition } from "@/lib/overlay";
import type {
  OverlayWidgetType,
  OverlayWidgetLayout,
  WidgetAnchor,
  VoiceLayoutMode,
} from "@/lib/overlay";

const store = useGameOverlaySettings();

// Reference resolution the offsets are expressed against (drag math only).
const REF_W = 1920;
const REF_H = 1080;
// Representative on-screen size (logical px @ scale 1) per widget, for the preview box.
const REP: Record<OverlayWidgetType, { w: number; h: number }> = {
  voice: { w: 220, h: 168 },
  chat: { w: 300, h: 150 },
  notifications: { w: 280, h: 72 },
};

const anchors: { value: WidgetAnchor; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
];

const voiceModes: { value: VoiceLayoutMode; label: string }[] = [
  { value: "list", label: "List" },
  { value: "bar", label: "Bar" },
  { value: "avatars", label: "Avatars" },
  { value: "grid", label: "Grid" },
];

interface WidgetMeta {
  type: OverlayWidgetType;
  label: string;
  icon: typeof Mic;
  layout: OverlayWidgetLayout;
}

const widgets = computed<WidgetMeta[]>(() => [
  { type: "voice", label: "Voice", icon: Mic, layout: store.hud.widgets.voice },
  { type: "chat", label: "Chat", icon: MessageSquare, layout: store.hud.widgets.chat },
  { type: "notifications", label: "Alerts", icon: Bell, layout: store.hud.widgets.notifications },
]);
const visibleWidgets = computed(() => widgets.value.filter((w) => w.layout.visible));

const selected = ref<OverlayWidgetType | null>("voice");
const selectedWidget = computed(() => widgets.value.find((w) => w.type === selected.value) ?? null);

/** Voice anchor lives in the legacy `overlayAnchor`; others in hud.widgets[type]. */
function anchorOf(type: OverlayWidgetType): WidgetAnchor {
  return type === "voice" ? store.overlayAnchor : store.hud.widgets[type].anchor;
}
function setAnchor(type: OverlayWidgetType, anchor: WidgetAnchor): void {
  if (type === "voice") store.overlayAnchor = anchor;
  else store.setWidgetLayout(type, { anchor });
  // Snap to the new corner.
  store.setWidgetLayout(type, { offsetX: 0, offsetY: 0 });
}
function setLayout(type: OverlayWidgetType, patch: Partial<OverlayWidgetLayout>): void {
  store.setWidgetLayout(type, patch);
}
function setVisible(type: OverlayWidgetType, visible: boolean): void {
  store.setWidgetLayout(type, { visible });
}
function select(type: OverlayWidgetType | null): void {
  selected.value = type;
}
function resetAll(): void {
  store.resetHud();
  selected.value = "voice";
}

// ── Preview geometry ──
const previewEl = ref<HTMLElement | null>(null);
const pw = ref(480);
const ph = computed(() => (pw.value * REF_H) / REF_W);
const scale = computed(() => pw.value / REF_W); // preview px per screen px

let ro: ResizeObserver | null = null;
onMounted(() => {
  if (previewEl.value) {
    pw.value = previewEl.value.clientWidth;
    ro = new ResizeObserver(() => {
      if (previewEl.value) pw.value = previewEl.value.clientWidth;
    });
    ro.observe(previewEl.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());

function boxStyle(w: WidgetMeta): Record<string, string> {
  const s = scale.value;
  const bw = REP[w.type].w * w.layout.scale * s;
  const bh = REP[w.type].h * w.layout.scale * s;
  const pos = computeAnchoredPosition(
    anchorOf(w.type),
    { x: pw.value, y: ph.value },
    { x: bw, y: bh },
    store.overlayScreenPadding * s,
    w.layout.offsetX * s,
    w.layout.offsetY * s,
  );
  return {
    left: `${pos.x}px`,
    top: `${pos.y}px`,
    width: `${bw}px`,
    height: `${bh}px`,
    opacity: String(0.55 + 0.45 * w.layout.opacity),
  };
}

// ── Drag ──
let drag: { type: OverlayWidgetType; startX: number; startY: number; offX: number; offY: number } | null = null;

function startDrag(type: OverlayWidgetType, e: PointerEvent): void {
  select(type);
  const l = store.hud.widgets[type];
  drag = { type, startX: e.clientX, startY: e.clientY, offX: l.offsetX, offY: l.offsetY };
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  window.addEventListener("pointermove", onDrag);
  window.addEventListener("pointerup", endDrag);
}
function onDrag(e: PointerEvent): void {
  if (!drag) return;
  const s = scale.value || 1;
  const dx = (e.clientX - drag.startX) / s;
  const dy = (e.clientY - drag.startY) / s;
  store.setWidgetLayout(drag.type, {
    offsetX: Math.round(drag.offX + dx),
    offsetY: Math.round(drag.offY + dy),
  });
}
function endDrag(): void {
  drag = null;
  window.removeEventListener("pointermove", onDrag);
  window.removeEventListener("pointerup", endDrag);
}
</script>

<style scoped>
.preview {
  @apply relative w-full rounded-xl border border-white/10 overflow-hidden select-none;
  aspect-ratio: 16 / 9;
  background:
    radial-gradient(120% 120% at 50% 0%, rgba(99, 102, 241, 0.12), transparent 60%),
    linear-gradient(135deg, #14141a, #0c0c10);
  touch-action: none;
}
.preview-grid {
  @apply absolute inset-0 pointer-events-none opacity-[0.06];
  background-image: linear-gradient(#fff 1px, transparent 1px),
    linear-gradient(90deg, #fff 1px, transparent 1px);
  background-size: 10% 10%, 10% 10%;
}
.widget-box {
  @apply absolute flex items-center gap-1.5 px-2 rounded-lg text-[11px] font-medium text-white
         cursor-grab active:cursor-grabbing border border-white/15 bg-white/10 backdrop-blur-sm
         overflow-hidden;
  align-content: flex-start;
}
.widget-box.selected {
  @apply border-primary/70 bg-primary/20 ring-1 ring-primary/40;
}
.chip {
  @apply flex items-center gap-1.5 rounded-lg border border-white/10 bg-card px-2.5 py-1.5 text-sm
         text-muted-foreground transition-colors hover:text-foreground;
}
.chip-on { @apply text-foreground; }
.chip-sel { @apply border-primary/50 bg-primary/10 text-foreground; }
.setting-sub-card {
  @apply rounded-xl border border-white/10 bg-black/20 p-4;
}
.anchor-grid {
  @apply grid grid-cols-3 gap-1.5 w-[120px];
}
.anchor-cell {
  @apply flex items-center justify-center h-7 rounded-md bg-white/5 hover:bg-white/10 transition-colors;
}
.anchor-cell .dot {
  @apply w-1.5 h-1.5 rounded-full bg-muted-foreground/50;
}
.anchor-on { @apply bg-primary/20; }
.anchor-on .dot { @apply bg-primary; }
.mode-chip {
  @apply rounded-md border border-white/10 px-2.5 py-1 text-xs text-muted-foreground
         hover:text-foreground transition-colors;
}
.mode-on { @apply border-primary/50 bg-primary/15 text-foreground; }
.toggle-row {
  @apply flex items-center justify-between text-sm;
}
</style>
