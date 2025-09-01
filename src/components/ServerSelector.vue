<template>
    <div
        class="server-list-container flex flex-col items-center py-3 justify-between rounded-xl space-y-3 w-55 min-w-[60px] max-w-[60px]">
        <Button variant="ghost" size="icon" class="w-12 h-12 rounded-full hover:rounded-2xl transition-all duration-200"
            @click="emit('home')">
            <IconSw class="w-8 h-8 fill-blue-500" />
        </Button>

        <Separator class="my-3" />

        <div class="flex flex-col gap-3">
            <Button :variant="'secondary'" size="icon" v-for="s in spaces" :key="s.spaceId"
                :aria-current="isSelected(s.spaceId)" class="relative w-12 h-12 transition-all duration-200
                   hover:rounded-2xl" :class="[
                    isSelected(s.spaceId) ? 'rounded-2xl' : 'rounded-full'
                ]" @click="select(s.spaceId)">
                <div class="flex items-center justify-center w-full h-full">
                    <Avatar class="w-8 h-8">
                        <AvatarImage v-if="s.avatarFieldId" :src="s.avatarFieldId" :alt="s.name" />
                        <AvatarFallback>{{ initials(s.name) }}</AvatarFallback>
                    </Avatar>
                </div>
                <span class="absolute -left-2 w-1 h-6 rounded-full transition-all duration-400"
                    :class="isSelected(s.spaceId) ? 'bg-blue-500' : 'bg-blue-500/0'" />
            </Button>
        </div>
        <Button variant="ghost" size="icon" class="w-12 h-12 rounded-full hover:rounded-2xl transition-all duration-200"
            @click="createSpaceOpened = true">
            <Plus class="w-4 h-4" />
        </Button>
        <div class="flex-1" />
    </div>

    <CreateOrJoinSpace v-model:open="createSpaceOpened" @create="create" @join="join"/>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Home, Plus } from "lucide-vue-next"
import IconSw from "@/assets/icons/icon_cat.svg"
import { ArgonSpaceBase } from "@/lib/glue/argonChat"
import { Guid } from "@argon-chat/ion.webcore"
import { useLocale } from "@/store/localeStore"
import CreateOrJoinSpace from "./modals/CreateOrJoinSpace.vue"

const { t } = useLocale();

const createSpaceOpened = ref(false);

const props = defineProps<{
    spaces: ArgonSpaceBase[]
}>()

const model = defineModel<string | null>('selectedSpace', {
    type: String, required: false
})

const emit = defineEmits<{
    (e: 'home'): void
    (e: 'create', name: string): void
    (e: 'join', name: string): void
    (e: 'select', id: Guid): void
}>()


function create(name: string) {
    emit("create", name);
}
function join(inviteCode: string) {
    emit("join", inviteCode);
}


const isSelected = (id: string) => model.value === id
const select = (id: string) => emit("select", id);

const initials = (name: string) =>
    name
        .trim()
        .split(/\s+/)
        .map(w => w[0]?.toUpperCase() ?? '')
        .slice(0, 2)
        .join('')
</script>
<style lang="css" scoped>
.server-list-container {
    background-color: #161616f5;
    border-radius: 15px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
</style>