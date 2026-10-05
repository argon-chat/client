<template>
    <div
        class="admin-controls"
        v-if="me.me"
        v-show="pex.has('ManageServer') || pex.has('ManageChannels') || pex.has('ManageArchetype') || pex.has('ManageBots')"
    >
        <button class="icon-motion icon-motion--pop"
            v-show="pex.has('ManageServer') || pex.has('ManageArchetype') || pex.has('ManageBots')"
            @click="openServerSettings"
            title="Server settings"
        >
            <SettingsIcon class="w-4 h-4" />
        </button>
        <!-- A channel outside any group. Once a space has channels, the list only offers to add
             one from a group's menu, which left no way to make a second top-level channel. -->
        <button class="icon-motion icon-motion--pop"
            v-show="pex.has('ManageChannels')"
            @click="addChannelOpened = true"
            :title="t('add_channel')"
            data-testid="admin-add-channel"
        >
            <PlusIcon class="w-4 h-4" />
        </button>
        <button class="icon-motion icon-motion--pop"
            v-show="pex.has('ManageChannels')"
            @click="addGroupOpened = true"
            title="New group"
        >
            <FolderPlusIcon class="w-4 h-4" />
        </button>

        <AddChannel
            v-model:open="addChannelOpened"
            v-model:group-id="noGroup"
            :selected-space="selectedSpaceId"
            @close="addChannelOpened = false; noGroup = null"
        />
        <AddChannelGroup v-model:open="addGroupOpened" :selected-space="selectedSpaceId" />
    </div>
</template>

<script setup lang="ts">
import { SettingsIcon, FolderPlusIcon, PlusIcon } from "lucide-vue-next";
import { useMe } from "@/store/auth/meStore";
import { useWindow } from "@/store/ui/windowStore";
import { usePexStore } from "@/store/data/permissionStore";
import { useLocale } from "@/store/system/localeStore";
import { ref, shallowRef, onUnmounted } from "vue";
import AddChannel from "./modals/AddChannel.vue";
import AddChannelGroup from "./modals/AddChannelGroup.vue";

const selectedSpaceId = defineModel<string>('selectedSpace', {
    type: String, required: true
})

const me = useMe();
const windows = useWindow();
const pex = usePexStore();
const { t } = useLocale();
const addGroupOpened = shallowRef(false);
const addChannelOpened = shallowRef(false);
/** The modal's group model: always "no group" from here, but it is a model so the modal can reset it. */
const noGroup = ref<string | null>(null);

async function openServerSettings() {
    windows.serverSettingsOpen = true;
}

onUnmounted(() => {
    addGroupOpened.value = false;
    addChannelOpened.value = false;
});
</script>

<style scoped>
.admin-controls {
    display: flex;
    align-items: center;
    gap: 4px;
}

.admin-controls button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 8px;
    color: #fff;
    background: hsl(0 0% 0% / 0.35);
    backdrop-filter: blur(4px);
    cursor: pointer;
    transition: background 0.15s ease, transform 0.05s ease;
}

.admin-controls button:hover {
    background: hsl(0 0% 0% / 0.6);
}

.admin-controls button:active {
    transform: scale(0.94);
}
</style>
