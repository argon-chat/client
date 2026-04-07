<script setup lang="ts">
import { onMounted, computed } from "vue";
import { useNotificationStore } from "@/store/data/notificationStore";
import { useLocale } from "@/store/system/localeStore";
import { Button } from "@argon/ui/button";
import { Separator } from "@argon/ui/separator";
import { ScrollArea } from "@argon/ui/scroll-area";
import { BellIcon, UserPlusIcon, PackageIcon, MegaphoneIcon, CheckCheckIcon } from "lucide-vue-next";
import NotificationItem from "./NotificationItem.vue";

const { t } = useLocale();
const ntf = useNotificationStore();

const friendRequests = computed(() =>
  ntf.notificationFeed.filter((n) => n.type === "friend_request_received" || n.type === "friend_request_accepted"),
);
const inventoryItems = computed(() =>
  ntf.notificationFeed.filter((n) => n.type === "item_received"),
);
const systemAnnouncements = computed(() =>
  ntf.notificationFeed.filter((n) => n.type === "system_announcement"),
);

const hasAny = computed(() => ntf.notificationFeed.length > 0);

function loadMore() {
  if (!ntf.feedHasMore || ntf.notificationFeed.length === 0) return;
  const lastItem = ntf.notificationFeed[ntf.notificationFeed.length - 1];
  ntf.loadNotificationFeed(25, lastItem.createdAt);
}

onMounted(() => {
  ntf.loadNotificationFeed(25);
});
</script>

<template>
  <div class="w-[380px] max-h-[500px] flex flex-col">
    <div class="flex items-center justify-between px-4 py-3 border-b border-border">
      <h3 class="text-sm font-semibold">{{ t("notifications") }}</h3>
      <Button
        v-if="hasAny"
        variant="ghost"
        size="sm"
        class="text-xs h-7"
        @click="ntf.markAllNotificationsRead()"
      >
        <CheckCheckIcon class="w-3.5 h-3.5 mr-1" />
        {{ t("mark_all_read") || "Mark all read" }}
      </Button>
    </div>

    <ScrollArea class="flex-1 max-h-[440px]">
      <div v-if="!hasAny" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <BellIcon class="w-8 h-8 mb-2 opacity-50" />
        <p class="text-sm">{{ t("no_notifications") || "No notifications" }}</p>
      </div>

      <div v-else class="py-1">
        <!-- Friend Requests -->
        <div v-if="friendRequests.length > 0">
          <div class="flex items-center justify-between px-4 py-2">
            <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <UserPlusIcon class="w-3.5 h-3.5" />
              {{ t("friends") || "Friends" }}
            </div>
            <Button
              v-if="ntf.notifications.friendRequests > 0"
              variant="ghost"
              size="sm"
              class="text-xs h-6 px-2"
              @click="ntf.markAllNotificationsRead('friend_request_received')"
            >
              {{ t("mark_read") || "Mark read" }}
            </Button>
          </div>
          <NotificationItem
            v-for="item in friendRequests"
            :key="item.id"
            :notification="item"
            @mark-read="ntf.markNotificationRead(item.id)"
          />
        </div>

        <Separator v-if="friendRequests.length > 0 && inventoryItems.length > 0" class="my-1" />

        <!-- Inventory -->
        <div v-if="inventoryItems.length > 0">
          <div class="flex items-center justify-between px-4 py-2">
            <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <PackageIcon class="w-3.5 h-3.5" />
              {{ t("inventory") || "Inventory" }}
            </div>
            <Button
              v-if="ntf.notifications.inventory > 0"
              variant="ghost"
              size="sm"
              class="text-xs h-6 px-2"
              @click="ntf.markAllNotificationsRead('item_received')"
            >
              {{ t("mark_read") || "Mark read" }}
            </Button>
          </div>
          <NotificationItem
            v-for="item in inventoryItems"
            :key="item.id"
            :notification="item"
            @mark-read="ntf.markNotificationRead(item.id)"
          />
        </div>

        <Separator v-if="(friendRequests.length > 0 || inventoryItems.length > 0) && systemAnnouncements.length > 0" class="my-1" />

        <!-- System -->
        <div v-if="systemAnnouncements.length > 0">
          <div class="flex items-center justify-between px-4 py-2">
            <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <MegaphoneIcon class="w-3.5 h-3.5" />
              {{ t("system") || "System" }}
            </div>
            <Button
              v-if="ntf.notifications.system > 0"
              variant="ghost"
              size="sm"
              class="text-xs h-6 px-2"
              @click="ntf.markAllNotificationsRead('system_announcement')"
            >
              {{ t("mark_read") || "Mark read" }}
            </Button>
          </div>
          <NotificationItem
            v-for="item in systemAnnouncements"
            :key="item.id"
            :notification="item"
            @mark-read="ntf.markNotificationRead(item.id)"
          />
        </div>

        <!-- Load more -->
        <div v-if="ntf.feedHasMore" class="flex justify-center py-3">
          <Button variant="ghost" size="sm" class="text-xs" @click="loadMore">
            {{ t("load_more") || "Load more" }}
          </Button>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
