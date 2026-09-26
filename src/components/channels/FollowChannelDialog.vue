<template>
  <Dialog v-model:open="open">
    <DialogContent described class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("follow_channel_title", { channel: channelName }) }}</DialogTitle>
        <DialogDescription>{{ t("follow_channel_desc") }}</DialogDescription>
      </DialogHeader>

      <p
        v-if="!spaces.length"
        class="rounded-md bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground"
        data-testid="follow-no-spaces"
      >
        {{ t("follow_no_spaces") }}
      </p>

      <template v-else>
        <div class="space-y-1.5">
          <Label>{{ t("follow_pick_space") }}</Label>
          <div class="picker-list max-h-44" role="listbox" data-testid="follow-spaces">
            <button
              v-for="space in spaces"
              :key="space.spaceId"
              type="button"
              role="option"
              class="picker-row"
              :class="{ 'picker-row--active': selectedSpaceId === space.spaceId }"
              :aria-selected="selectedSpaceId === space.spaceId"
              :data-space="space.spaceId"
              @click="pickSpace(space.spaceId)"
            >
              <ArgonAvatar
                :file-id="space.avatarFieldId"
                :fallback="space.name"
                :space-id="space.spaceId"
                :overrided-size="24"
                class="w-6 h-6 rounded-md shrink-0"
              />
              <span class="truncate">{{ space.name }}</span>
            </button>
          </div>
        </div>

        <div class="space-y-1.5">
          <Label>{{ t("follow_pick_channel") }}</Label>
          <p v-if="!selectedSpaceId" class="px-1 py-2 text-xs text-muted-foreground">
            {{ t("follow_pick_space_first") }}
          </p>
          <p
            v-else-if="!sections.length"
            class="rounded-md bg-muted/50 px-3 py-3 text-center text-xs text-muted-foreground"
            data-testid="follow-no-channels"
          >
            {{ t("follow_no_channels") }}
          </p>
          <div v-else class="picker-list max-h-52" role="listbox" data-testid="follow-channels">
            <template v-for="section in sections" :key="section.key">
              <div v-if="section.name !== null" class="picker-group" :title="section.name">{{ section.name }}</div>
              <button
                v-for="channel in section.channels"
                :key="channel.channelId"
                type="button"
                role="option"
                class="picker-row"
                :class="{ 'picker-row--active': selectedChannelId === channel.channelId }"
                :aria-selected="selectedChannelId === channel.channelId"
                :data-channel="channel.channelId"
                @click="selectedChannelId = channel.channelId"
              >
                <component
                  :is="channel.type === ChannelType.Announcement ? AntennaIcon : HashIcon"
                  class="w-4 h-4 shrink-0 text-muted-foreground"
                />
                <span class="truncate">{{ channel.name }}</span>
              </button>
            </template>
          </div>
        </div>
      </template>

      <DialogFooter>
        <Button variant="outline" @click="open = false">{{ t("cancel") }}</Button>
        <Button :disabled="!selectedChannel || following" data-testid="follow-confirm" @click="confirm">
          <Loader2 v-if="following" class="w-4 h-4 mr-2 animate-spin" />
          {{ t("follow_confirm") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * Follow an announcement channel: pick one of your spaces where you manage channels, then a text
 * or announcement channel there, and its published posts start arriving in that channel.
 */
import { ref, watch } from "vue";
import { AntennaIcon, HashIcon, Loader2 } from "lucide-vue-next";
import { ChannelType } from "@argon/glue";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { Label } from "@argon/ui/label";
import { useToast } from "@argon/ui/toast";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { useLocale } from "@/store/system/localeStore";
import { useChannelFollow, useFollowTargets } from "@/composables/useChannelFollow";

const props = defineProps<{
  /** The announcement channel being followed. */
  spaceId: string;
  channelId: string;
  channelName: string;
}>();

const open = defineModel<boolean>("open", { default: false });

const { t } = useLocale();
const { toast } = useToast();
const { follow } = useChannelFollow();
const { spaces, sections, selectedSpaceId, selectedChannelId, selectedChannel, pickSpace, reset } = useFollowTargets(
  () => props.channelId,
);

const following = ref(false);

watch(open, (isOpen) => {
  if (isOpen) reset();
});

// One space to choose from: choose it. Read only while open, so a closed dialog asks nothing.
watch(
  () => (open.value && !selectedSpaceId.value && spaces.value.length === 1 ? spaces.value[0].spaceId : null),
  (only) => {
    if (only) pickSpace(only);
  },
  { immediate: true },
);

async function confirm() {
  const target = selectedChannel.value;
  if (!target || following.value) return;
  following.value = true;
  try {
    const outcome = await follow(
      { spaceId: props.spaceId, channelId: props.channelId },
      { spaceId: target.spaceId, channelId: target.channelId },
    );
    if (outcome.ok) {
      toast({
        title: t("follow_success", { target: outcome.link.targetChannelName, source: outcome.link.sourceChannelName }),
      });
      open.value = false;
    } else {
      toast({ title: t("follow_failed"), description: t(outcome.errorKey), variant: "destructive" });
    }
  } finally {
    following.value = false;
  }
}
</script>

<style scoped>
.picker-list {
  overflow-y: auto;
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 0.5rem;
  padding: 4px;
}

.picker-group {
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

.picker-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border-radius: calc(var(--radius) - 4px);
  font-size: 0.875rem;
  text-align: left;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.picker-row:hover {
  background-color: hsl(var(--foreground) / 0.06);
}

.picker-row--active,
.picker-row--active:hover {
  background-color: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
}
</style>
