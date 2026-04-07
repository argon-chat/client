<script setup lang="ts">
import { computed } from "vue";
import type { SystemNotificationDto } from "@argon/glue";
import { UserPlusIcon, PackageIcon, MegaphoneIcon, UserCheckIcon } from "lucide-vue-next";

const props = defineProps<{
  notification: SystemNotificationDto;
}>();

const emit = defineEmits<{
  (e: "mark-read"): void;
}>();

const icon = computed(() => {
  switch (props.notification.type) {
    case "friend_request_received": return UserPlusIcon;
    case "friend_request_accepted": return UserCheckIcon;
    case "item_received": return PackageIcon;
    case "system_announcement": return MegaphoneIcon;
    default: return MegaphoneIcon;
  }
});

const timeAgo = computed(() => {
  const now = Date.now();
  const created = props.notification.createdAt.date.getTime();
  const diff = now - created;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
});
</script>

<template>
  <div
    class="flex items-start gap-3 px-4 py-2.5 hover:bg-accent/50 cursor-pointer transition-colors"
    :class="{ 'opacity-60': notification.isRead }"
    @click="emit('mark-read')"
  >
    <div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
      :class="notification.isRead ? 'bg-muted' : 'bg-primary/10'">
      <component :is="icon" class="w-4 h-4" :class="notification.isRead ? 'text-muted-foreground' : 'text-primary'" />
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <p class="text-sm font-medium truncate" :class="{ 'font-semibold': !notification.isRead }">
          {{ notification.title }}
        </p>
        <span v-if="!notification.isRead" class="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
      </div>
      <p v-if="notification.body" class="text-xs text-muted-foreground mt-0.5 line-clamp-2">
        {{ notification.body }}
      </p>
      <span class="text-[10px] text-muted-foreground mt-0.5">{{ timeAgo }}</span>
    </div>
  </div>
</template>
