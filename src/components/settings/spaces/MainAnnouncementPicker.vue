<template>
  <div class="space-y-4" data-testid="main-announcement-picker">
    <div class="flex items-center gap-2">
      <AntennaIcon class="w-5 h-5" />
      <h3 class="text-lg font-semibold">{{ t("main_announcement_channel") }}</h3>
    </div>

    <div class="flex items-center justify-between gap-4">
      <p class="text-sm text-muted-foreground">
        {{ channels.length > 0 ? t("main_announcement_channel_desc") : t("main_announcement_channel_empty") }}
      </p>
      <Select :model-value="selected" :disabled="saving" @update:model-value="choose">
        <SelectTrigger class="w-[220px] shrink-0" data-testid="main-announcement-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem :value="NONE">{{ t("main_announcement_channel_none") }}</SelectItem>
            <SelectItem v-for="channel in channels" :key="channel.channelId" :value="channel.channelId">
              {{ channel.name }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AntennaIcon } from "lucide-vue-next";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@argon/ui/select";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { ChannelType, SetMainAnnouncementChannelError } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { db } from "@/store/db/dexie";
import { useApi } from "@/store/system/apiStore";
import { useLocale } from "@/store/system/localeStore";
import { useLiveQuery } from "@/composables/useLiveQuery";

const props = defineProps<{
  spaceId: Guid;
  /** `ArgonSpaceBase.mainAnnouncementChannelId` as stored. */
  current: Guid | null;
}>();

// reka-ui's Select has no empty value, so "none" stands for null.
const NONE = "none";

const { t } = useLocale();
const api = useApi();
const { toast } = useToast();

const rows = useLiveQuery(() =>
  db.channels
    .where("spaceId")
    .equals(props.spaceId)
    .filter((c) => c.type === ChannelType.Announcement)
    .toArray(),
);
const channels = computed(() => [...(rows.value ?? [])].sort((a, b) => a.name.localeCompare(b.name)));

const selected = ref<string>(props.current ?? NONE);
const saving = ref(false);

watch(
  () => props.current,
  (current) => {
    if (!saving.value) selected.value = current ?? NONE;
  },
);

function errorText(error: SetMainAnnouncementChannelError): string {
  switch (error) {
    case SetMainAnnouncementChannelError.NO_PERMISSION:
      return t("channel_error_no_permission");
    case SetMainAnnouncementChannelError.CHANNEL_NOT_FOUND:
    case SetMainAnnouncementChannelError.NOT_ANNOUNCEMENT_CHANNEL:
      return t("main_announcement_channel_gone");
    default:
      return t("main_announcement_channel_failed");
  }
}

async function choose(value: unknown) {
  if (typeof value !== "string" || saving.value) return;
  const channelId = value === NONE ? null : value;
  if (channelId === props.current) return;

  saving.value = true;
  selected.value = value;
  try {
    const result = await api.spaceAnnouncementInteraction.SetMainAnnouncementChannel(props.spaceId, channelId);
    if (result.isSuccessSetMainAnnouncementChannel()) {
      // SpaceDetailsUpdated brings the same; writing it now keeps the picker from flicking back.
      await db.servers.update(props.spaceId, { mainAnnouncementChannelId: channelId });
      toast({ title: t("main_announcement_channel_saved") });
    } else if (result.isFailedSetMainAnnouncementChannel()) {
      selected.value = props.current ?? NONE;
      toast({ title: t("main_announcement_channel_failed"), description: errorText(result.error), variant: "destructive" });
    }
  } catch (e) {
    logger.error("[MainAnnouncementPicker] could not set the main announcement channel", e);
    selected.value = props.current ?? NONE;
    toast({ title: t("main_announcement_channel_failed"), variant: "destructive" });
  } finally {
    saving.value = false;
  }
}
</script>
