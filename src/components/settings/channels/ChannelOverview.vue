<template>
  <div class="space-y-6">
    <div class="setting-card space-y-5">
      <div class="flex items-center gap-2">
        <component :is="typeIcon" class="w-5 h-5" />
        <h3 class="text-lg font-semibold">{{ t("overview") }}</h3>
      </div>

      <div class="space-y-2">
        <Label for="channel-settings-name">{{ t("channel_name") }}</Label>
        <Input id="channel-settings-name" v-model="form.name" maxlength="128" :placeholder="t('channel_name')" />
      </div>

      <template v-if="isVoice">
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-4">
            <Label>{{ t("channel_bitrate") }}</Label>
            <span class="text-sm tabular-nums text-muted-foreground">{{ bitrateLabel }}</span>
          </div>
          <Slider
            :model-value="[form.bitrate ?? DEFAULT_BITRATE_KBPS]"
            :min="MIN_BITRATE_KBPS"
            :max="MAX_BITRATE_KBPS"
            :step="BITRATE_STEP"
            @update:model-value="onBitrateInput" />
          <div class="flex items-start justify-between gap-3">
            <p class="text-xs text-muted-foreground">{{ t("channel_bitrate_desc") }}</p>
            <Button v-if="form.bitrate !== null" variant="ghost" size="sm" class="text-xs shrink-0" @click="form.bitrate = null">
              {{ t("reset") }}
            </Button>
          </div>
        </div>

        <div class="space-y-2">
          <Label>{{ t("channel_region") }}</Label>
          <!-- Disabled on purpose: the voice server is picked automatically today. The control is
               here so the sheet already has the shape it will have once regions can be chosen. -->
          <Select disabled model-value="auto">
            <SelectTrigger class="w-full">
              <SelectValue>{{ t("region_auto") }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{{ t("region_auto") }}</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">{{ t("channel_region_desc") }}</p>
        </div>
      </template>

      <div v-if="isText" class="space-y-2">
        <Label>{{ t("slow_mode") }}</Label>
        <Select v-model="slowModeValue">
          <SelectTrigger class="w-full">
            <SelectValue>{{ slowModeLabel(form.slowMode) }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="opt in slowModeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        <p class="text-xs text-muted-foreground">{{ t("slow_mode_desc") }}</p>
      </div>

      <div class="flex justify-end gap-2 pt-1">
        <Button variant="outline" :disabled="!dirty || saving" @click="resetForm">{{ t("reset") }}</Button>
        <Button :disabled="!dirty || saving || !form.name.trim()" @click="save">
          <Loader2 v-if="saving" class="w-4 h-4 mr-2 animate-spin" />
          {{ saving ? t("saving") : t("save_changes") }}
        </Button>
      </div>
    </div>

    <DangerZone v-if="canManageChannels" :title="t('delete_channel')" :description="t('delete_channel_desc')">
      <button class="danger-btn" :disabled="deleting" @click="showDeleteDialog = true">
        <TrashIcon class="w-4 h-4" />
        <span>{{ t("delete_channel") }}</span>
      </button>
    </DangerZone>

    <Dialog v-model:open="showDeleteDialog">
      <DialogContent @interactOutside.prevent>
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2 text-red-500">
            <AlertTriangleIcon class="w-5 h-5" />
            {{ t("delete_channel") }}
          </DialogTitle>
        </DialogHeader>

        <div class="space-y-4">
          <p class="text-sm">{{ t("delete_channel_confirmation", { name: channel.name }) }}</p>
          <div class="space-y-2">
            <label class="text-sm font-medium">{{ t("type_channel_name_to_confirm") }}</label>
            <Input v-model="deleteConfirmationName" :placeholder="channel.name" class="font-mono" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="showDeleteDialog = false">{{ t("cancel") }}</Button>
          <Button
            variant="destructive"
            :disabled="deleteConfirmationName !== channel.name || deleting"
            @click="confirmDelete">
            {{ t("delete_channel") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * The "Overview" tab of the channel settings: name, and what applies to the channel's kind —
 * bitrate and region for voice, slow mode for text — with deletion in the danger zone below.
 *
 * Everything but deletion goes through one UpdateChannel call with only the changed fields set,
 * which is the contract the server offers (null = leave alone, 0 = clear).
 */
import { computed, reactive, ref, watch } from "vue";
import { Input } from "@argon/ui/input";
import { Label } from "@argon/ui/label";
import { Button } from "@argon/ui/button";
import { Slider } from "@argon/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@argon/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { AlertTriangleIcon, TrashIcon, HashIcon, Volume2Icon, AntennaIcon, Loader2 } from "lucide-vue-next";
import { ChannelType, UpdateChannelError, type ArgonChannel } from "@argon/glue";
import DangerZone from "@/components/shared/DangerZone.vue";
import { useApi } from "@/store/system/apiStore";
import { useLocale } from "@/store/system/localeStore";
import { usePexStore } from "@/store/data/permissionStore";
import { useChannelStore } from "@/store/data/channelStore";
import { useSpaceStore } from "@/store/data/serverStore";
import { useWindow } from "@/store/ui/windowStore";

const props = defineProps<{ channel: ArgonChannel }>();

/** What the client publishes at when the channel has no bitrate of its own (the SDK's stereo music preset). */
const DEFAULT_BITRATE_KBPS = 64;
/** Mirrors ChannelEntity.MinBitrateKbps / MaxBitrateKbps on the server. */
const MIN_BITRATE_KBPS = 8;
const MAX_BITRATE_KBPS = 320;
const BITRATE_STEP = 8;
/** Mirrors ChannelEntity.AllowedSlowModeSeconds on the server: a picker, not a free number. */
const SLOW_MODE_CHOICES = [0, 5, 15, 30, 60, 300];

const api = useApi();
const { t } = useLocale();
const { toast } = useToast();
const pex = usePexStore();
const channelStore = useChannelStore();
const servers = useSpaceStore();
const windows = useWindow();

const isVoice = computed(() => props.channel.type === ChannelType.Voice);
const isText = computed(() => props.channel.type === ChannelType.Text);
const canManageChannels = computed(() => pex.has("ManageChannels"));

const typeIcon = computed(() => {
  switch (props.channel.type) {
    case ChannelType.Voice: return Volume2Icon;
    case ChannelType.Announcement: return AntennaIcon;
    default: return HashIcon;
  }
});

// ── Form ──

const form = reactive({
  name: props.channel.name,
  bitrate: (props.channel.bitrate ?? null) as number | null,
  slowMode: props.channel.slowModeSeconds ?? 0,
});

function resetForm() {
  form.name = props.channel.name;
  form.bitrate = props.channel.bitrate ?? null;
  form.slowMode = props.channel.slowModeSeconds ?? 0;
}

const dirty = computed(
  () =>
    form.name !== props.channel.name ||
    (isVoice.value && form.bitrate !== (props.channel.bitrate ?? null)) ||
    (isText.value && form.slowMode !== (props.channel.slowModeSeconds ?? 0)),
);

// A change that arrives from elsewhere (another admin renamed it) replaces the form only while
// nothing here is being edited; otherwise what the user typed wins until they save or reset.
watch(
  () => props.channel,
  () => {
    if (!dirty.value) resetForm();
  },
  { deep: true },
);

const bitrateLabel = computed(() =>
  form.bitrate === null
    ? t("channel_bitrate_default", { kbps: DEFAULT_BITRATE_KBPS })
    : `${form.bitrate} ${t("kbps")}`,
);

function onBitrateInput(value: number[] | undefined) {
  const kbps = value?.[0];
  if (kbps !== undefined) form.bitrate = kbps;
}

function slowModeLabel(seconds: number): string {
  if (seconds === 0) return t("slow_mode_off");
  if (seconds < 60) return t("slow_mode_seconds", { n: seconds });
  if (seconds === 60) return t("slow_mode_one_minute");
  return t("slow_mode_minutes", { n: seconds / 60 });
}

const slowModeOptions = computed(() =>
  SLOW_MODE_CHOICES.map((seconds) => ({ value: String(seconds), label: slowModeLabel(seconds) })),
);

// The select speaks strings; the form keeps the number the server wants.
const slowModeValue = computed({
  get: () => String(form.slowMode),
  set: (value: string) => {
    form.slowMode = Number(value);
  },
});

// ── Save ──

const saving = ref(false);

async function save() {
  if (saving.value || !dirty.value) return;
  const name = form.name.trim();
  if (!name) return;

  saving.value = true;
  try {
    const result = await api.channelInteraction.UpdateChannel(
      props.channel.spaceId,
      props.channel.channelId,
      name !== props.channel.name ? name : null,
      null,
      isText.value && form.slowMode !== (props.channel.slowModeSeconds ?? 0) ? form.slowMode : null,
      isVoice.value && form.bitrate !== (props.channel.bitrate ?? null) ? (form.bitrate ?? 0) : null,
    );

    if (result.isSuccessUpdateChannel()) {
      // The row comes back with its real high-water mark, so it can be stored as is — and storing
      // it now means the sidebar and this form catch up without waiting for the event.
      await channelStore.trackChannel(result.channel);
      toast({ title: t("channel_saved") });
    } else {
      const error = result.isFailedUpdateChannel() ? result.error : UpdateChannelError.NONE;
      toast({ title: t("channel_save_failed"), description: errorText(error), variant: "destructive" });
    }
  } catch (e) {
    logger.error("[ChannelOverview] save failed", e);
    toast({ title: t("channel_save_failed"), variant: "destructive" });
  } finally {
    saving.value = false;
  }
}

function errorText(error: UpdateChannelError): string {
  switch (error) {
    case UpdateChannelError.NAME_EMPTY:
      return t("channel_error_name_empty");
    case UpdateChannelError.NAME_TOO_LONG:
      return t("channel_error_name_too_long");
    case UpdateChannelError.BITRATE_OUT_OF_RANGE:
      return t("channel_error_bitrate", { min: MIN_BITRATE_KBPS, max: MAX_BITRATE_KBPS });
    default:
      return UpdateChannelError[error] ?? String(error);
  }
}

// ── Delete ──

const showDeleteDialog = ref(false);
const deleteConfirmationName = ref("");
const deleting = ref(false);

watch(showDeleteDialog, (open) => {
  if (!open) deleteConfirmationName.value = "";
});

async function confirmDelete() {
  if (deleting.value) return;
  deleting.value = true;
  try {
    await servers.deleteChannel(props.channel.channelId, props.channel.spaceId);
    showDeleteDialog.value = false;
    windows.closeChannelSettings();
  } catch (e) {
    logger.error("[ChannelOverview] delete failed", e);
    toast({ title: t("channel_delete_failed"), variant: "destructive" });
  } finally {
    deleting.value = false;
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
</style>
