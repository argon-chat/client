<script setup lang="ts">
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import UserProfilePopover from "@/components/popovers/UserProfilePopover.vue";
import { RealtimeUser } from "@/store/db/dexie";
import { useLocale } from "@/store/localeStore";
import { usePoolStore } from "@/store/poolStore";
import { useMe } from "@/store/meStore";
import { ref, computed } from "vue";
import { ActivityPresenceKind } from "@/lib/glue/argonChat";

const { t } = useLocale();
const pool = usePoolStore();
const me = useMe();
const isOpened = ref(false);

export type FriendListItemVm =
    | {
        kind: "friend";
        userId: string;
        displayName: string;
    }
    | {
        kind: "incoming";
        userId: string;
        displayName: string;
    }
    | {
        kind: "outgoing";
        userId: string;
        displayName: string;
    }
    | {
        kind: "blocked";
        userId: string;
        displayName: string;
    };

const props = defineProps<{
    item: FriendListItemVm;
    disabled?: boolean;
}>();

const user = pool.getUserReactive(computed(() => props.item.userId));

const emit = defineEmits<{
    (e: "accept", fromUserId: string): void;
    (e: "decline", fromUserId: string): void;
    (e: "cancel", toUserId: string): void;
    (e: "unfriend", toUserId: string): void;
}>();

const getTextForActivityKind = (activityKind: ActivityPresenceKind) => {
    switch (activityKind) {
        case ActivityPresenceKind.GAME:
            return "activity_play_in";
        case ActivityPresenceKind.SOFTWARE:
            return "activity_work_in";
        case ActivityPresenceKind.STREAMING:
            return "activity_stream";
        case ActivityPresenceKind.LISTEN:
            return "activity_listen";
        default:
            return "error";
    }
};

</script>

<template>
    <Popover v-if="user && item.kind === 'friend'" v-model:open="isOpened">
        <PopoverContent 
            style="width: 19rem; min-height: 25rem;"
            class="p-0 rounded-2xl shadow-xl border border-neutral-800 bg-[#09090b] text-white overflow-hidden"
        >
            <UserProfilePopover :user-id="user.userId" @close:pressed="isOpened = false" />
        </PopoverContent>
        <PopoverTrigger as-child>
            <div 
                class="flex justify-between items-center p-3 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer"
                :class="{ 'opacity-50 pointer-events-none': disabled }"
            >
                <div class="flex items-center gap-3 flex-1 min-w-0">
                    <div class="relative">
                        <SmartArgonAvatar :user-id="user.userId" :overrided-size="40" />
                        <span 
                            :class="me.statusClass(user.status)"
                            class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-gray-800"
                        ></span>
                    </div>
                    <div class="flex flex-col min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <span class="text-sm font-medium truncate">{{ user.displayName }}</span>
                        </div>
                        <span 
                            v-if="user.activity" 
                            class="text-[10px] flex items-center text-muted-foreground truncate"
                        >
                            {{ t(getTextForActivityKind(user.activity.kind)) }}
                            <span class="font-bold pl-1 truncate">
                                {{ user.activity.titleName }}
                            </span>
                        </span>
                    </div>
                </div>

                <div class="flex gap-2 shrink-0" @click.stop>
                    <Button 
                        variant="outline" 
                        size="sm" 
                        :disabled="disabled"
                        @click="emit('unfriend', item.userId)"
                    >
                        {{ t("unfriend") }}
                    </Button>
                </div>
            </div>
        </PopoverTrigger>
    </Popover>

    <div 
        v-else-if="user"
        class="flex justify-between items-center p-3 rounded-lg hover:bg-accent/50 transition-colors"
        :class="{ 'opacity-50 pointer-events-none': disabled }"
    >
        <div class="flex items-center gap-3 flex-1 min-w-0">
            <SmartArgonAvatar :user-id="user.userId" :overrided-size="40" />
            <div class="flex items-center gap-2 min-w-0">
                <span class="text-sm font-medium truncate">{{ user.displayName }}</span>
                <Badge 
                    v-if="item.kind === 'incoming'" 
                    variant="default" 
                    class="shrink-0 text-xs"
                >
                    {{ t("incoming_request") }}
                </Badge>
                <Badge 
                    v-else-if="item.kind === 'outgoing'" 
                    variant="secondary" 
                    class="shrink-0 text-xs"
                >
                    {{ t("outgoing_request") }}
                </Badge>
                <Badge 
                    v-else-if="item.kind === 'blocked'" 
                    variant="destructive" 
                    class="shrink-0 text-xs"
                >
                    {{ t("blocked") }}
                </Badge>
            </div>
        </div>

        <div class="flex gap-2 shrink-0">
            <template v-if="item.kind === 'incoming'">
                <Button 
                    size="sm" 
                    :disabled="disabled"
                    @click="emit('accept', item.userId)"
                >
                    {{ t("accept") }}
                </Button>
                <Button 
                    variant="destructive" 
                    size="sm" 
                    :disabled="disabled"
                    @click="emit('decline', item.userId)"
                >
                    {{ t("decline") }}
                </Button>
            </template>

            <template v-else-if="item.kind === 'outgoing'">
                <Button 
                    variant="secondary" 
                    size="sm" 
                    :disabled="disabled"
                    @click="emit('cancel', item.userId)"
                >
                    {{ t("cancel") }}
                </Button>
            </template>

            <template v-else-if="item.kind === 'blocked'">
                <Button variant="secondary" size="sm" disabled>
                    {{ t("blocked") }}
                </Button>
            </template>
        </div>
    </div>
</template>
