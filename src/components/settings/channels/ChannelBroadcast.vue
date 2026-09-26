<template>
  <div class="space-y-6">
    <div class="setting-card space-y-5">
      <div class="flex items-start justify-between gap-4">
        <div class="flex items-start gap-2 min-w-0">
          <RadioTowerIcon class="w-5 h-5 mt-0.5 shrink-0" />
          <div class="min-w-0">
            <h3 class="text-lg font-semibold leading-tight">{{ t("broadcast_mode") }}</h3>
            <p class="text-xs text-muted-foreground mt-1">{{ t("broadcast_mode_desc") }}</p>
          </div>
        </div>
        <Switch
          data-testid="broadcast-mode"
          :checked="enabled"
          :disabled="toggling || !canManageChannels"
          @update:checked="setMode" />
      </div>

      <template v-if="enabled && settings">
        <div v-if="warning.open.value" class="banner banner-warn" data-testid="broadcast-open-warning">
          <TriangleAlertIcon class="w-5 h-5 text-yellow-400 flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-yellow-200">{{ t("broadcast_open_warning") }}</p>
            <p class="text-xs text-yellow-200/60 mt-0.5">{{ t("broadcast_open_warning_desc") }}</p>
          </div>
          <Button
            v-if="canEditOverwrites"
            size="sm"
            variant="outline"
            class="border-yellow-400/30 text-yellow-200 hover:bg-yellow-400/10 shrink-0"
            data-testid="broadcast-open-permissions"
            @click="windows.channelSettingsTab = 'permissions'">
            {{ t("broadcast_open_warning_action") }}
          </Button>
        </div>

        <!-- Targets -->
        <div class="space-y-2">
          <Label>{{ t("broadcast_targets") }}</Label>
          <p class="text-xs text-muted-foreground">{{ t("broadcast_targets_desc") }}</p>
          <div class="target-list" data-testid="broadcast-targets">
            <template v-for="section in targetSections" :key="section.key">
              <div v-if="section.name !== null" class="target-group" :title="section.name">{{ section.name }}</div>
              <label
                v-for="row in section.channels"
                :key="row.channelId"
                class="target-row"
                :class="{ 'target-row--disabled': row.disabled }"
                :data-target="row.channelId">
                <Checkbox
                  :model-value="form.targets.includes(row.channelId)"
                  :disabled="row.disabled"
                  @update:model-value="(v) => setTarget(row.channelId, v === true)" />
                <Volume2Icon class="w-4 h-4 text-muted-foreground shrink-0" />
                <span class="truncate">{{ row.name }}</span>
                <span v-if="row.disabled" class="ml-auto text-xs text-muted-foreground shrink-0">
                  {{ t("broadcast_is_broadcast_channel") }}
                </span>
              </label>
            </template>
            <p v-if="targetSections.length === 0" class="text-xs text-muted-foreground px-2 py-3">
              {{ t("broadcast_no_targets") }}
            </p>
          </div>
        </div>

        <!-- Overlap -->
        <div class="space-y-2">
          <Label>{{ t("broadcast_overlap") }}</Label>
          <Select v-model="overlapValue">
            <SelectTrigger class="w-full" data-testid="broadcast-overlap">
              <SelectValue>{{ t(overlapOption.labelKey) }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt in OVERLAP_OPTIONS" :key="opt.value" :value="String(opt.value)">
                {{ t(opt.labelKey) }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">{{ t(overlapOption.descKey) }}</p>
        </div>

        <!-- Ducking -->
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-4">
            <Label>{{ t("broadcast_ducking") }}</Label>
            <span class="text-sm tabular-nums text-muted-foreground">{{ form.duckingDb }} dB</span>
          </div>
          <Slider
            :model-value="[form.duckingDb]"
            :min="MIN_DUCKING_DB"
            :max="MAX_DUCKING_DB"
            :step="1"
            @update:model-value="onDuckingInput" />
          <div class="flex items-start justify-between gap-3">
            <p class="text-xs text-muted-foreground">{{ t("broadcast_ducking_desc") }}</p>
            <Button
              variant="outline"
              size="sm"
              class="shrink-0"
              :disabled="testing"
              data-testid="broadcast-ducking-test"
              @click="playDuckingTest">
              <Loader2 v-if="testing" class="w-4 h-4 mr-2 animate-spin" />
              <PlayIcon v-else class="w-4 h-4 mr-2" />
              {{ t("broadcast_ducking_test") }}
            </Button>
          </div>
        </div>

        <!-- Max transmit -->
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-4">
            <div class="min-w-0">
              <Label>{{ t("broadcast_limit") }}</Label>
              <p class="text-xs text-muted-foreground">{{ t("broadcast_limit_desc") }}</p>
            </div>
            <Switch data-testid="broadcast-limit" :checked="form.limitOn" @update:checked="(v: boolean) => (form.limitOn = v)" />
          </div>
          <div v-if="form.limitOn" class="flex items-center gap-2">
            <Input
              v-model="limitValue"
              type="number"
              inputmode="numeric"
              :min="MIN_MAX_TRANSMIT_SECONDS"
              :max="MAX_MAX_TRANSMIT_SECONDS"
              step="1"
              class="w-28 tabular-nums"
              data-testid="broadcast-limit-seconds"
              @blur="form.maxTransmitSeconds = clampTransmitSeconds(form.maxTransmitSeconds)" />
            <span class="text-sm text-muted-foreground">{{ t("broadcast_limit_seconds") }}</span>
          </div>
        </div>

        <!-- Chirp -->
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <Label>{{ t("broadcast_chirp") }}</Label>
            <p class="text-xs text-muted-foreground">{{ t("broadcast_chirp_desc") }}</p>
          </div>
          <Switch data-testid="broadcast-chirp" :checked="form.chirp" @update:checked="(v: boolean) => (form.chirp = v)" />
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <Button variant="outline" :disabled="!dirty || saving" @click="resetForm">{{ t("reset") }}</Button>
          <Button :disabled="!dirty || saving || !canManageChannels" data-testid="broadcast-save" @click="save">
            <Loader2 v-if="saving" class="w-4 h-4 mr-2 animate-spin" />
            {{ saving ? t("saving") : t("save_changes") }}
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The "Broadcast" tab of the channel settings, for voice channels: the mode switch and, while it
 * is on, the radio's settings — who hears it, what happens when two people key at once, how far
 * the listeners' channel is turned down, the stuck-key limit and the chirp.
 *
 * The switch talks to the server at once; everything else is a form saved with one sparse patch
 * (only the keys that changed). A change made elsewhere replaces the form only while nothing here
 * is being edited, as in the Overview tab.
 */
import { computed, reactive, ref, toRef, watch } from "vue";
import { Label } from "@argon/ui/label";
import { Input } from "@argon/ui/input";
import { Button } from "@argon/ui/button";
import { Switch } from "@argon/ui/switch";
import { Slider } from "@argon/ui/slider";
import { Checkbox } from "@argon/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@argon/ui/select";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { Loader2, PlayIcon, RadioTowerIcon, TriangleAlertIcon, Volume2Icon } from "lucide-vue-next";
import { BroadcastOverlap, ChannelType, SetBroadcastSettingsError, type ArgonChannel, type BroadcastSettings } from "@argon/glue";
import { audio } from "@/lib/audio/AudioManager";
import { useApi } from "@/store/system/apiStore";
import { useLocale } from "@/store/system/localeStore";
import { usePexStore } from "@/store/data/permissionStore";
import { useChannelStore } from "@/store/data/channelStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useWindow } from "@/store/ui/windowStore";
import { useChannelGroups } from "@/composables/useChannelGroups";
import { useBroadcastOpenWarning } from "@/composables/useBroadcastOpenWarning";
import {
  OVERLAP_OPTIONS,
  MIN_DUCKING_DB,
  MAX_DUCKING_DB,
  MIN_MAX_TRANSMIT_SECONDS,
  MAX_MAX_TRANSMIT_SECONDS,
  DEFAULT_MAX_TRANSMIT_SECONDS,
  broadcastErrorKey,
  buildBroadcastPatch,
  clampDuckingDb,
  clampTransmitSeconds,
  formFromSettings,
  isBroadcastFormDirty,
  type BroadcastForm,
} from "@/composables/useBroadcastSettings";

const props = defineProps<{ channel: ArgonChannel }>();

const api = useApi();
const { t } = useLocale();
const { toast } = useToast();
const pex = usePexStore();
const pool = usePoolStore();
const channelStore = useChannelStore();
const windows = useWindow();

const settings = computed(() => props.channel.broadcast);
const enabled = computed(() => settings.value !== null);
const canManageChannels = computed(() => pex.hasIn(props.channel.channelId, "ManageChannels", props.channel.spaceId));
// The permissions tab needs both, like the drawer that shows it.
const canEditOverwrites = computed(
  () => pex.hasInSpace(props.channel.spaceId, "ManageChannels") && pex.hasInSpace(props.channel.spaceId, "ManageArchetype"),
);

const warning = useBroadcastOpenWarning(toRef(props, "channel"), enabled);

// ── Mode ──

const toggling = ref(false);

async function setMode(on: boolean) {
  if (toggling.value || on === enabled.value) return;
  toggling.value = true;
  try {
    const result = await api.channelInteraction.SetBroadcastMode(props.channel.spaceId, props.channel.channelId, on);
    if (result.isSuccessSetBroadcastSettings()) {
      await channelStore.trackChannel(result.channel);
      toast({ title: t(on ? "broadcast_mode_enabled" : "broadcast_mode_disabled") });
    } else {
      const error = result.isFailedSetBroadcastSettings() ? result.error : SetBroadcastSettingsError.NONE;
      toast({ title: t("broadcast_enable_failed"), description: t(broadcastErrorKey(error)), variant: "destructive" });
    }
  } catch (e) {
    logger.error("[ChannelBroadcast] SetBroadcastMode failed", e);
    toast({ title: t("broadcast_enable_failed"), variant: "destructive" });
  } finally {
    toggling.value = false;
  }
}

// ── Form ──

const EMPTY: BroadcastSettings = {
  targets: [],
  overlap: BroadcastOverlap.MIX,
  duckingDb: -8,
  maxTransmitSeconds: DEFAULT_MAX_TRANSMIT_SECONDS,
  chirp: false,
};

const form = reactive<BroadcastForm>(formFromSettings(settings.value ?? EMPTY));

function resetForm() {
  Object.assign(form, formFromSettings(settings.value ?? EMPTY));
}

const dirty = computed(() => settings.value !== null && isBroadcastFormDirty(settings.value, form));

watch(
  settings,
  (next, prev) => {
    if (!next) return;
    // Just switched on, or nothing being edited: take what the server has.
    if (!prev || !dirty.value) resetForm();
  },
  { deep: true },
);

function setTarget(channelId: string, on: boolean) {
  const has = form.targets.includes(channelId);
  if (on && !has) form.targets = [...form.targets, channelId];
  else if (!on && has) form.targets = form.targets.filter((id) => id !== channelId);
}

// The select speaks strings; the form keeps the enum.
const overlapValue = computed({
  get: () => String(form.overlap),
  set: (value: string) => {
    form.overlap = Number(value) as BroadcastOverlap;
  },
});
const overlapOption = computed(() => OVERLAP_OPTIONS.find((o) => o.value === form.overlap) ?? OVERLAP_OPTIONS[0]);

function onDuckingInput(value: number[] | undefined) {
  const db = value?.[0];
  if (db !== undefined) form.duckingDb = clampDuckingDb(db);
}

const limitValue = computed({
  get: () => String(form.maxTransmitSeconds),
  set: (value: string | number) => {
    const n = Number(value);
    if (Number.isFinite(n)) form.maxTransmitSeconds = n;
  },
});

// ── Targets: the space's voice channels, grouped as the sidebar shows them ──

const spaceId = computed(() => props.channel.spaceId);
const channels = pool.useActiveServerChannels(spaceId);
const { sortedGroups, sortByFractionalIndex } = useChannelGroups(spaceId);

interface TargetRow {
  channelId: string;
  name: string;
  /** A broadcast channel cannot be a target (decision 8). */
  disabled: boolean;
}

const rowsOf = (list: ArgonChannel[]): TargetRow[] =>
  sortByFractionalIndex(
    list.filter((c) => c.type === ChannelType.Voice && c.channelId !== props.channel.channelId),
  ).map((c) => ({ channelId: c.channelId, name: c.name, disabled: c.broadcast !== null }));

const targetSections = computed(() => {
  const sections: { key: string; name: string | null; channels: TargetRow[] }[] = [];
  const ungrouped = rowsOf(channels.value.filter((c) => c.groupId === null));
  if (ungrouped.length > 0) sections.push({ key: "ungrouped", name: null, channels: ungrouped });
  for (const group of sortedGroups.value) {
    const rows = rowsOf(channels.value.filter((c) => c.groupId === group.groupId));
    if (rows.length > 0) sections.push({ key: group.groupId, name: group.name, channels: rows });
  }
  return sections;
});

// ── Ducking test ──

const testing = ref(false);

/**
 * A soft chord through a gain of our own into the app's output, turned down to the slider's
 * value half a second in and back up a second and a half later — the dip a listener will hear.
 * Self-contained: nothing here touches the call's audio graph.
 */
async function playDuckingTest() {
  if (testing.value) return;
  testing.value = true;
  const TOTAL = 2.8;
  try {
    const destination = audio.getOutputDestination();
    const ctx = destination.context;
    if (ctx.state === "suspended" && "resume" in ctx) await (ctx as AudioContext).resume();

    const duck = ctx.createGain();
    duck.gain.value = 1;
    duck.connect(destination);

    const sample = ctx.createGain();
    sample.gain.value = 0.12;
    sample.connect(duck);

    const now = ctx.currentTime;
    for (const freq of [261.63, 329.63, 392.0]) {
      const osc = ctx.createOscillator();
      const envelope = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(1, now + 0.05);
      envelope.gain.setValueAtTime(1, now + TOTAL - 0.15);
      envelope.gain.linearRampToValueAtTime(0, now + TOTAL);
      osc.connect(envelope);
      envelope.connect(sample);
      osc.start(now);
      osc.stop(now + TOTAL);
    }

    const level = Math.pow(10, clampDuckingDb(form.duckingDb) / 20);
    duck.gain.setValueAtTime(1, now + 0.5);
    duck.gain.linearRampToValueAtTime(level, now + 0.56);
    duck.gain.setValueAtTime(level, now + 2.0);
    duck.gain.linearRampToValueAtTime(1, now + 2.1);

    await new Promise((resolve) => setTimeout(resolve, TOTAL * 1000 + 100));
    sample.disconnect();
    duck.disconnect();
  } catch (e) {
    logger.warn("[ChannelBroadcast] ducking test failed", e);
  } finally {
    testing.value = false;
  }
}

// ── Save ──

const saving = ref(false);

async function save() {
  const current = settings.value;
  if (!current || saving.value || !dirty.value) return;
  const patch = buildBroadcastPatch(current, form);
  if (Object.keys(patch).length === 0) return;

  saving.value = true;
  try {
    const result = await api.channelInteraction.PatchBroadcastSettings(props.channel.spaceId, props.channel.channelId, patch);
    if (result.isSuccessSetBroadcastSettings()) {
      await channelStore.trackChannel(result.channel);
      // What the server kept (a clamped limit, a dropped target) is what the form shows now.
      if (result.channel.broadcast) Object.assign(form, formFromSettings(result.channel.broadcast));
      toast({ title: t("broadcast_saved") });
    } else {
      const error = result.isFailedSetBroadcastSettings() ? result.error : SetBroadcastSettingsError.NONE;
      toast({ title: t("broadcast_save_failed"), description: t(broadcastErrorKey(error)), variant: "destructive" });
    }
  } catch (e) {
    logger.error("[ChannelBroadcast] save failed", e);
    toast({ title: t("broadcast_save_failed"), variant: "destructive" });
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.setting-card {
  border-radius: 0.75rem;
  border: 1px solid hsl(var(--border) / 0.5);
  background-color: hsl(var(--card) / var(--card-alpha));
  padding: 1.5rem;
  overflow: hidden;
}

.banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid;
  padding: 0.875rem 1.25rem;
}

.banner-warn {
  border-color: rgb(250 204 21 / 0.2);
  background-color: rgb(250 204 21 / 0.05);
}

.target-list {
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 0.5rem;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px;
}

.target-group {
  padding: 8px 8px 2px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.target-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: calc(var(--radius) - 4px);
  font-size: 0.875rem;
  cursor: pointer;
}

.target-row:hover {
  background-color: hsl(var(--foreground) / 0.06);
}

.target-row--disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.target-row--disabled:hover {
  background-color: transparent;
}
</style>
