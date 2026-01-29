<template>
  <Dialog v-model:open="open">
    <template #default="{ close }">
      <DialogContent class="sm:max-w-[500px] rounded-2xl border bg-card/95 backdrop-blur-2xl p-8 space-y-6">
        <div
          class="absolute inset-0 bg-gradient-to-t from-primary/5 via-transparent to-primary/5 pointer-events-none rounded-2xl">
        </div>

        <div class="relative text-center space-y-2">
          <h2 class="text-3xl font-extrabold text-foreground tracking-wide">
            {{ t("meeting_details") }}
          </h2>
          <p class="text-sm text-muted-foreground">
            {{ t("meeting_started_at") }}: {{ formatDate(meetingInfo?.startDate) }}
          </p>
        </div>

        <div class="relative space-y-4">
          <!-- Meeting code input -->
          <div class="space-y-2">
            <label class="text-sm font-medium flex items-center gap-2">
              <Hash class="w-4 h-4 text-muted-foreground" />
              {{ t("meeting_code") }}
            </label>
            <div class="relative">
              <Input :model-value="meetingInfo?.meetingCode || ''" readonly placeholder="XXX-XXX-XXX"
                class="h-14 text-center font-mono text-2xl tracking-[0.3em] uppercase pr-12" />
              <!-- Code validation indicator -->
              <div class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <div v-for="i in 3" :key="i"
                  class="w-2 h-2 rounded-full transition-all duration-300 bg-green-500 scale-110" />
              </div>
            </div>
            <p class="text-xs text-muted-foreground text-center">
              {{ t("share_this_code_with_participants") }}
            </p>
          </div>

          <!-- Meeting URL -->
          <div class="space-y-2">
            <label class="text-sm font-medium flex items-center gap-2">
              <Link2 class="w-4 h-4 text-muted-foreground" />
              {{ t("meeting_url") }}
            </label>
            <div class="flex gap-2">
              <Input :model-value="meetingInfo?.meetingUrl || ''" readonly class="flex-1" />
              <Button @click="copyMeetingUrl" variant="outline" size="icon" class="flex-shrink-0">
                <Copy class="w-4 h-4" />
              </Button>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex gap-2 pt-4">
            <Button @click="copyMeetingUrl" variant="outline" class="flex-1">
              <Copy class="w-4 h-4 mr-2" />
              {{ t("copy_invite_link") }}
            </Button>

            <Button v-if="canManageChannels" @click="() => endMeeting(close)" variant="destructive" class="flex-1">
              <X class="w-4 h-4 mr-2" />
              {{ t("end_meeting") }}
            </Button>
          </div>
        </div>
      </DialogContent>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Hash, Link2, Copy, X } from 'lucide-vue-next';
import {
  Dialog,
  DialogContent,
} from '@argon/ui/dialog';
import { Button } from '@argon/ui/button';
import { Input } from '@argon/ui/input';
import { useLocale } from '@/store/localeStore';
import { usePexStore } from '@/store/permissionStore';
import { useApi } from '@/store/apiStore';
import { logger } from '@argon/core';
import type { LinkedMeetingInfo } from '@argon/glue';
import type { DateTimeOffset, Guid } from '@argon-chat/ion.webcore';

const props = defineProps<{
  meetingInfo?: LinkedMeetingInfo;
  spaceId: Guid;
  channelId: Guid;
}>();

const open = defineModel<boolean>('open', { required: true });

const { t } = useLocale();
const pex = usePexStore();
const api = useApi();

const canManageChannels = computed(() => pex.has('ManageChannels'));

const formatDate = (dateTimeOffset?: DateTimeOffset) => {
  if (!dateTimeOffset?.date) return '';
  return new Date(dateTimeOffset.date).toLocaleString();
};

const copyMeetingUrl = async () => {
  if (!props.meetingInfo?.meetingUrl) return;

  try {
    await navigator.clipboard.writeText(props.meetingInfo.meetingUrl);
    logger.info('Meeting URL copied to clipboard');
    // TODO: Show toast notification
  } catch (error) {
    logger.error('Failed to copy meeting URL', error);
  }
};

const endMeeting = async (close: () => void) => {
  try {
    await api.channelInteraction.EndLinkedMeeting(props.spaceId, props.channelId);
    logger.info('Meeting ended successfully');
    close();
  } catch (error) {
    logger.error('Failed to end meeting', error);
  }
};
</script>
