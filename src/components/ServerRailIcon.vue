<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <div class="rail-slot group" :class="{ 'is-active': active }">
        <span class="rail-indicator" />
        <button
          class="rail-btn"
          :aria-current="active || undefined"
          draggable="true"
          @click="emit('select')"
          @dragstart="emit('dragstart', $event)"
          @dragover.prevent="emit('dragover', $event)"
          @drop="emit('drop', $event)"
          @dragend="emit('dragend')"
          @contextmenu.prevent="emit('contextmenu', $event)"
        >
          <span class="rail-avatar">
            <ArgonAvatar
              class="w-full h-full"
              :file-id="server.avatarFieldId"
              :space-id="server.spaceId"
              :fallback="initials(server.name)"
            />
          </span>

          <IconPinFilled v-if="pinned" class="rail-pin" />

          <span v-if="mentions > 0" class="rail-badge">{{ mentions > 99 ? '99+' : mentions }}</span>
          <span v-else-if="hasUnread" class="rail-dot" />
        </button>
      </div>
    </TooltipTrigger>
    <TooltipContent side="right" :side-offset="12" class="font-medium">
      {{ server.name }}
    </TooltipContent>
  </Tooltip>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ArgonAvatar from "./ArgonAvatar.vue";
import { Tooltip, TooltipTrigger, TooltipContent } from "@argon/ui/tooltip";
import { IconPinFilled } from "@tabler/icons-vue";
import type { ArgonSpaceBase } from "@argon/glue";
import { useNotificationStore } from "@/store/data/notificationStore";

const props = defineProps<{
  server: ArgonSpaceBase;
  active?: boolean;
  pinned?: boolean;
}>();

const emit = defineEmits<{
  select: [];
  dragstart: [event: DragEvent];
  dragover: [event: DragEvent];
  drop: [event: DragEvent];
  dragend: [];
  contextmenu: [event: MouseEvent];
}>();

const ntf = useNotificationStore();

const muted = computed(() => ntf.isTargetMuted(props.server.spaceId));
const mentions = computed(() =>
  muted.value ? 0 : (ntf.getSpaceBadge(props.server.spaceId)?.totalMentions ?? 0),
);
const hasUnread = computed(() =>
  !muted.value && (ntf.getSpaceBadge(props.server.spaceId)?.unreadChannelCount ?? 0) > 0,
);

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
</script>

<style scoped>
.rail-slot {
  position: relative;
  display: flex;
  justify-content: center;
  width: 100%;
}

/* Left active/hover indicator pill (flush to the rail's left edge). */
.rail-indicator {
  position: absolute;
  left: 0;
  top: 50%;
  width: 4px;
  height: 0;
  border-radius: 0 4px 4px 0;
  background: hsl(var(--foreground));
  transform: translateY(-50%);
  opacity: 0;
  transition: height 0.18s ease, opacity 0.18s ease;
}

.rail-slot:hover .rail-indicator {
  height: 18px;
  opacity: 0.6;
}

.rail-slot.is-active .rail-indicator {
  height: 36px;
  opacity: 1;
}

.rail-btn {
  position: relative;
  width: 48px;
  height: 48px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
}

.rail-btn[draggable="true"]:active {
  cursor: grabbing;
}

/* Avatar clip — morphs from circle to squircle on hover/active. */
.rail-avatar {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 50%;
  transition: border-radius 0.18s ease, transform 0.12s ease;
}

.rail-slot:hover .rail-avatar {
  border-radius: 16px;
}

.rail-slot.is-active .rail-avatar {
  border-radius: 16px;
}

.rail-btn:active .rail-avatar {
  transform: scale(0.92);
}

.rail-pin {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
  color: hsl(var(--primary));
  filter: drop-shadow(0 0 2px hsl(var(--card)));
  z-index: 2;
}

.rail-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: hsl(var(--destructive));
  color: hsl(var(--destructive-foreground));
  font-size: 10px;
  font-weight: 700;
  border: 2px solid hsl(var(--card));
  z-index: 2;
}

.rail-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid hsl(var(--card));
  z-index: 2;
}
</style>
