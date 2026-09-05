<script setup lang="ts">
/**
 * Hotkeys settings: every action with the key bound to it.
 *
 * A fixed list rather than an "add hotkey" flow: each action does one thing, so there is nothing
 * to configure beyond the key. Click the key field, press the combination, done. Push-to-talk gets
 * its two options underneath the voice group once it has a key.
 */
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useLocale } from "@/store/system/localeStore";
import { useHotkeys } from "@/store/ui/hotKeyStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import {
  HOTKEY_ACTIONS,
  HOTKEY_GROUPS,
  hotkeyAction,
  type HotkeyActionId,
  type HotkeyGroupId,
} from "@/lib/hotkeys/catalog";
import { chordLabels, detectHotkeyPlatform } from "@/lib/hotkeys/chord";
import { hotkeyHost } from "@/lib/hotkeys/host";
import { playUiBeep } from "@/lib/audio/uiBeep";
import { supports } from "@/lib/platform";
import { Button } from "@argon/ui/button";
import { Switch } from "@argon/ui/switch";
import { Slider } from "@argon/ui/slider";
import Kbd from "@/components/kbd/Kbd.vue";
import KbdGroup from "@/components/kbd/KbdGroup.vue";
import DesktopOnlyNotice from "@/components/shared/DesktopOnlyNotice.vue";
import {
  InfoIcon,
  MicIcon,
  MonitorIcon,
  PhoneIcon,
  RadioIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-vue-next";

const { t } = useLocale();
const hotkeys = useHotkeys();
const flags = useFeatureFlags();

const platform = detectHotkeyPlatform();
const isMac = platform === "mac";
const desktop = supports("globalHotkeys");

// ── Actions on offer ─────────────────────────────────────────────────

const overlayAvailable = computed(() => !isMac && flags.overlayGamesEnabled);

const groups = computed(() =>
  HOTKEY_GROUPS.map((group) => ({
    ...group,
    actions: HOTKEY_ACTIONS.filter(
      (a) => a.group === group.id && (a.requires !== "overlay" || overlayAvailable.value),
    ),
  })).filter((group) => group.actions.length > 0),
);

const GROUP_ICONS: Record<HotkeyGroupId, unknown> = {
  voice: MicIcon,
  call: PhoneIcon,
  app: MonitorIcon,
};

// ── Host state ───────────────────────────────────────────────────────

const status = computed(() => hotkeys.hostStatus);
const needsAccessibility = computed(
  () => desktop && isMac && status.value !== null && !status.value.accessibilityGranted,
);
const hostDown = computed(
  () => desktop && status.value !== null && !status.value.running && !needsAccessibility.value,
);

let statusTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  if (!desktop) return;
  void hotkeys.refreshStatus();
  // Permission granted in System Settings, or a hook coming back: cheap to keep looking.
  statusTimer = setInterval(() => {
    if (!hotkeys.hostStatus?.running) void hotkeys.refreshStatus();
  }, 3000);
});

onBeforeUnmount(() => {
  if (statusTimer) clearInterval(statusTimer);
  void hotkeys.cancelCapture();
});

async function requestAccessibility() {
  await hotkeyHost.requestAccessibility();
  await hotkeys.refreshStatus();
}

async function restartHost() {
  await hotkeys.restartHost();
}

// ── Recording ────────────────────────────────────────────────────────

const enabled = computed(() => hotkeys.options.enabled);

async function record(id: HotkeyActionId) {
  if (!enabled.value) return;
  if (hotkeys.capturingFor === id) {
    await hotkeys.cancelCapture();
    return;
  }
  playUiBeep("capture-start");
  const result = await hotkeys.captureFor(id);
  if (result === "bound") playUiBeep("capture-ok");
  else if (result === "failed") playUiBeep("capture-fail");
}

function clear(id: HotkeyActionId) {
  hotkeys.clearBinding(id);
}

function labels(id: HotkeyActionId): string[] {
  return chordLabels(hotkeys.chordOf(id), platform);
}

function conflictNames(id: HotkeyActionId): string {
  return hotkeys
    .conflictsOf(id)
    .map((other) => t(hotkeyAction(other)!.title))
    .join(", ");
}

// ── Push-to-talk options ─────────────────────────────────────────────

const pttBound = computed(() => hotkeys.isBound("voice.pushToTalk"));

const releaseDelay = computed<number[]>({
  get: () => [hotkeys.options.pttReleaseDelayMs],
  set: (v) => {
    hotkeys.options.pttReleaseDelayMs = Math.round(v[0] ?? 0);
  },
});
</script>

<template>
  <div class="hotkey-settings">
    <div class="settings-header">
      <div>
        <h2 class="text-2xl font-bold">{{ t("hotkeys") }}</h2>
        <p class="text-sm text-muted-foreground mt-1">{{ t("hotkeys_subtitle") }}</p>
      </div>
      <label v-if="desktop" class="master-switch">
        <span class="text-sm font-medium">{{ enabled ? t("enabled") : t("disabled") }}</span>
        <Switch :checked="enabled" @update:checked="(v: boolean) => (hotkeys.options.enabled = v)" />
      </label>
    </div>

    <!-- A page cannot listen for keys it never receives: nothing here is offered on the web. -->
    <DesktopOnlyNotice v-if="!desktop" title="hotkeys" description="desktop_only_hotkeys_desc" />

    <template v-else>
      <!-- macOS: the hook needs Accessibility -->
      <div v-if="needsAccessibility" class="banner banner-warn">
        <ShieldAlertIcon class="w-5 h-5 text-yellow-400 flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-yellow-200">{{ t("hotkeys_accessibility_required") }}</p>
          <p class="text-xs text-yellow-200/60 mt-0.5">{{ t("hotkeys_accessibility_description") }}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          class="border-yellow-400/30 text-yellow-200 hover:bg-yellow-400/10 shrink-0"
          @click="requestAccessibility"
        >
          {{ t("hotkeys_grant_access") }}
        </Button>
      </div>

      <!-- The hook is not installed for another reason -->
      <div v-else-if="hostDown" class="banner banner-error">
        <TriangleAlertIcon class="w-5 h-5 text-destructive flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium">{{ t("hotkeys_not_running") }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">{{ status?.error || t("hotkeys_not_running_desc") }}</p>
        </div>
        <Button size="sm" variant="outline" class="shrink-0 gap-2" @click="restartHost">
          <RotateCcwIcon class="w-4 h-4" />
          {{ t("hotkeys_restart") }}
        </Button>
      </div>

      <p v-if="!isMac" class="note">
        <InfoIcon class="w-4 h-4 shrink-0" />
        <span>{{ t("hotkey_admin_warning") }}</span>
      </p>

      <section
        v-for="group in groups"
        :key="group.id"
        class="group-card"
        :class="{ 'is-disabled': !enabled }"
      >
        <h3 class="group-title">
          <component :is="GROUP_ICONS[group.id]" class="w-5 h-5 text-primary" />
          {{ t(group.title) }}
        </h3>

        <div class="rows">
          <div
            v-for="action in group.actions"
            :key="action.id"
            class="action-row"
            :class="{ 'is-recording': hotkeys.capturingFor === action.id }"
          >
            <div class="action-info">
              <div class="action-title">
                {{ t(action.title) }}
                <span v-if="action.kind === 'hold'" class="kind-badge">{{ t("hotkeys_kind_hold") }}</span>
              </div>
              <div class="action-desc">{{ t(action.description) }}</div>
              <div v-if="conflictNames(action.id)" class="action-conflict">
                <TriangleAlertIcon class="w-3.5 h-3.5 shrink-0" />
                {{ t("hotkeys_conflict", { action: conflictNames(action.id) }) }}
              </div>
            </div>

            <div class="action-keys">
              <button
                type="button"
                class="key-field"
                :disabled="!enabled"
                :aria-label="t('hotkeys_record_aria', { action: t(action.title) })"
                @click="record(action.id)"
              >
                <template v-if="hotkeys.capturingFor === action.id">
                  <span class="rec-dot" />
                  <span>{{ t("hotkeys_press_keys") }}</span>
                  <span class="rec-hint">Esc</span>
                </template>
                <KbdGroup v-else-if="labels(action.id).length" class="gap-1">
                  <template v-for="(label, i) in labels(action.id)" :key="i">
                    <Kbd class="key-cap">{{ label }}</Kbd>
                    <span v-if="i < labels(action.id).length - 1" class="key-plus">+</span>
                  </template>
                </KbdGroup>
                <span v-else class="key-empty">{{ t("not_set") }}</span>
              </button>

              <Button
                variant="ghost"
                size="icon"
                class="clear-button"
                :class="{ invisible: !hotkeys.isBound(action.id) || hotkeys.capturingFor === action.id }"
                :aria-label="t('hotkeys_clear')"
                :title="t('hotkeys_clear')"
                @click="clear(action.id)"
              >
                <XIcon class="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <!-- Push-to-talk options, once it has a key -->
        <div v-if="group.id === 'voice' && pttBound" class="ptt-options">
          <div class="ptt-title">
            <RadioIcon class="w-4 h-4 text-primary" />
            {{ t("hotkeys_ptt_options") }}
          </div>

          <div class="ptt-row">
            <div class="min-w-0">
              <div class="text-sm">{{ t("hotkeys_ptt_release_delay") }}</div>
              <div class="action-desc">{{ t("hotkeys_ptt_release_delay_desc") }}</div>
            </div>
            <div class="ptt-slider">
              <Slider v-model="releaseDelay" :min="0" :max="1000" :step="10" :disabled="!enabled" />
              <span class="ptt-value">{{ hotkeys.options.pttReleaseDelayMs }} ms</span>
            </div>
          </div>

          <div class="ptt-row">
            <div class="min-w-0">
              <div class="text-sm">{{ t("hotkeys_ptt_radio_beeps") }}</div>
              <div class="action-desc">{{ t("hotkeys_ptt_radio_beeps_desc") }}</div>
            </div>
            <Switch
              :checked="hotkeys.options.pttRadioBeeps"
              :disabled="!enabled"
              @update:checked="(v: boolean) => (hotkeys.options.pttRadioBeeps = v)"
            />
          </div>
        </div>
      </section>

      <p v-if="hotkeys.captureError" class="text-sm text-destructive">
        {{ t("hotkeys_capture_failed") }}: {{ hotkeys.captureError }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.hotkey-settings {
  @apply space-y-6 max-w-5xl mx-auto;
}

.settings-header {
  @apply flex items-start justify-between gap-4;
}

.master-switch {
  @apply flex items-center gap-3 rounded-lg border px-4 py-2 cursor-pointer select-none shrink-0;
}

.banner {
  @apply rounded-xl border px-5 py-4 flex items-center gap-3;
}

.banner-warn {
  @apply border-yellow-400/20 bg-yellow-400/5;
}

.banner-error {
  @apply border-destructive/30 bg-destructive/5;
}

.note {
  @apply flex items-center gap-2 text-xs text-muted-foreground px-1;
}

/* Group */
.group-card {
  @apply rounded-xl border bg-card p-5 shadow-sm transition-all;
}

.group-title {
  @apply flex items-center gap-2 text-lg font-semibold mb-2;
}

.rows {
  @apply divide-y;
}

.group-card.is-disabled .rows,
.group-card.is-disabled .ptt-options {
  @apply opacity-50;
}

/* Row */
.action-row {
  @apply flex items-center gap-4 py-3;
}

.action-info {
  @apply flex-1 min-w-0;
}

.action-title {
  @apply text-sm font-medium flex items-center gap-2;
}

.kind-badge {
  @apply text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-muted text-muted-foreground;
}

.action-desc {
  @apply text-xs text-muted-foreground mt-0.5;
}

.action-conflict {
  @apply flex items-center gap-1 text-xs text-yellow-300 mt-1;
}

.action-keys {
  @apply flex items-center gap-1 shrink-0;
}

/* The key field */
.key-field {
  @apply min-w-[200px] h-10 px-3 rounded-md border bg-muted/30 flex items-center justify-center gap-2 text-sm
    transition-all hover:bg-muted/50 hover:border-primary/40
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
    disabled:cursor-not-allowed disabled:hover:bg-muted/30 disabled:hover:border-border;
}

.is-recording .key-field {
  @apply border-primary bg-primary/10 ring-2 ring-primary/30;
}

.rec-dot {
  @apply h-2 w-2 rounded-full bg-red-500 animate-pulse;
}

.rec-hint {
  @apply ml-1 rounded border px-1 text-[10px] text-muted-foreground;
}

.key-cap {
  @apply h-6 px-2 text-xs;
}

.key-plus {
  @apply mx-0.5 text-muted-foreground;
}

.key-empty {
  @apply text-muted-foreground italic;
}

.clear-button {
  @apply h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10;
}

/* Push-to-talk options */
.ptt-options {
  @apply mt-4 rounded-lg border border-dashed bg-muted/10 p-4 space-y-3;
}

.ptt-title {
  @apply flex items-center gap-2 text-sm font-medium;
}

.ptt-row {
  @apply flex items-center justify-between gap-6;
}

.ptt-slider {
  @apply flex items-center gap-3 w-64 shrink-0;
}

.ptt-value {
  @apply text-xs tabular-nums text-muted-foreground w-16 text-right;
}
</style>
