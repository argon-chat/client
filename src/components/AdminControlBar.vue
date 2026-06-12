<template>
    <div
        class="admin-controls"
        v-if="me.me"
        v-show="pex.has('ManageServer') || pex.has('ManageChannels') || pex.has('ManageArchetype') || pex.has('ManageBots')"
    >
        <button
            v-show="pex.has('ManageServer') || pex.has('ManageArchetype') || pex.has('ManageBots')"
            @click="openServerSettings"
            title="Server settings"
        >
            <SettingsIcon class="w-4 h-4" />
        </button>
        <button
            v-show="pex.has('ManageChannels')"
            @click="addGroupOpened = true"
            title="New group"
        >
            <FolderPlusIcon class="w-4 h-4" />
        </button>

        <AddChannelGroup v-model:open="addGroupOpened" :selected-space="selectedSpaceId" />
    </div>
</template>

<script setup lang="ts">
import { SettingsIcon, FolderPlusIcon } from "lucide-vue-next";
import { useMe } from "@/store/auth/meStore";
import { useWindow } from "@/store/ui/windowStore";
import { usePexStore } from "@/store/data/permissionStore";
import { shallowRef, onUnmounted } from "vue";
import AddChannelGroup from "./modals/AddChannelGroup.vue";

const selectedSpaceId = defineModel<string>('selectedSpace', {
    type: String, required: true
})

const me = useMe();
const windows = useWindow();
const pex = usePexStore();
const addGroupOpened = shallowRef(false);

async function openServerSettings() {
    windows.serverSettingsOpen = true;
}

onUnmounted(() => {
    addGroupOpened.value = false;
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
