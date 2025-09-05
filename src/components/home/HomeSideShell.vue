<script setup lang="ts">
import { ShrimpIcon, MessageSquareTextIcon } from 'lucide-vue-next';
import Button from '../ui/button/Button.vue';
import ControlBar from './../ControlBar.vue';
import UserBar from './../UserBar.vue';
import { IconCookieManFilled, IconTriangleInvertedFilled, IconUserScan, IconNotification } from "@tabler/icons-vue"
import { onMounted, PropType, ref } from 'vue';
import { usePoolStore } from '@/store/poolStore';
import { useMe } from '@/store/meStore';
import { RealtimeUser } from '@/store/db/dexie';
import { NBadge } from 'naive-ui';

const pool = usePoolStore();
const me = useMe();
const user = ref(null as RealtimeUser | null);

onMounted(async () => {
    user.value = await pool.getUser(me.me?.userId!) ?? null;
});

const tab = defineModel<'profile' | 'friends' | 'notifications' | 'inventory'>('tab', {
    type: String as PropType<'profile' | 'friends' | 'notifications' | 'inventory'>, default: 'profile'
})

const emit = defineEmits<{
    (e: 'select', tab: 'profile' | 'friends' | 'notifications' | 'inventory'): void
}>();

</script>

<template>
    <div class="channel-container flex flex-col justify-end rounded-xl space-y-3 w-55 min-w-60">
        <!-- <div class="header-list overflow-hidden h-20 justify-center font-bold text-4xl text-blue-500 text-center rounded-xl" style="border-radius: 15px;">
            Argon Chat
        </div> -->
        <div class="item-slot flex flex-1 justify-start items-stretch flex-col overflow-hidden gap-1 h-full rounded-xl"
            style="border-radius: 15px;">
            <Button @click="emit('select', 'profile')" :variant="tab == 'profile' ? 'outline' : 'ghost'"
                class="justify-start">
                <IconUserScan class="w-6 h-6 mr-2" />
                Profile
            </Button>
            <Button @click="emit('select', 'friends')" :variant="tab == 'friends' ? 'outline' : 'ghost'"
                class="justify-start">
                <IconCookieManFilled class="w-6 h-6 mr-2" />
                Friends
                <n-badge :value="0" :max="50" :offset="[10, -8]" />
            </Button>
            <!-- <Button variant="ghost" class="justify-start">
                <IconMessageChatbotFilled class="w-6 h-6 mr-2" />
                Direct
            </Button> -->
            <Button @click="emit('select', 'inventory')" :variant="tab == 'inventory' ? 'outline' : 'ghost'"
                class="justify-start">
                <IconTriangleInvertedFilled class="w-6 h-6 mr-2" />
                Inventory
                <n-badge :value="0" :max="50" :offset="[10, -8]" />
            </Button>
            <Button @click="emit('select', 'notifications')" :variant="tab == 'notifications' ? 'outline' : 'ghost'"
                class="justify-start">

                
                <IconNotification class="w-6 h-6 mr-2" />
                Notifications
                <n-badge :value="0" :max="50" :offset="[10, -8]" />
            </Button>


            <!-- <Separator />
            <p class="text-sm text-muted-foreground text-center">
                Direct Messages
            </p>
            <ul class="text-gray-400 space-y-2 pl-2 pr-2">
                <li
                    class="flex items-center space-x-3 hover:text-white user-item">
                    <UserInListSideElement v-if="user" :user="user" />
                </li>
                <li
                    class="flex items-center space-x-3 hover:text-white user-item">
                    <UserInListSideElement v-if="user" :user="user" />
                </li>
                <li
                    class="flex items-center space-x-3 hover:text-white user-item">
                    <UserInListSideElement v-if="user" :user="user" />
                </li>
            </ul> -->
        </div>
        <ControlBar />
        <UserBar />
    </div>
</template>

<style lang="css" scoped>
.item-slot {
    background-color: #161616f5;
    border-radius: 15px;
    padding: 10px;
    display: flex;
    position: relative;
}
</style>