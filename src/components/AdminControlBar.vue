<template>
    <div class="relative" style="z-index: 1;" v-if="me.me" v-show="pex.has('ManageServer')">
        <div class="control-bar">
            <div class="controls">
                <button @click="openServerSettings">
                    <SettingsIcon class="w-5 h-5" />
                </button>
                <button @click="addChannelOpened = true" v-if="false">
                    <CirclePlusIcon class="w-5 h-5" />
                </button>
                <button @click="addGroupOpened = true">
                    <FolderPlusIcon class="w-5 h-5" />
                </button>
                <button disabled>
                    <NotebookTabsIcon class="w-5 h-5" />
                </button>
                <button disabled>
                    <UsersIcon class="w-5 h-5" />
                </button>
                <button disabled>
                    <ShieldCheck class="w-5 h-5 good" />
                </button>
            </div>
        </div>
    </div>

    <AddChannel 
      v-model:open="addChannelOpened" 
      :selected-space="selectedSpaceId"
    />

    <AddChannelGroup
      v-model:open="addGroupOpened"
      :selected-space="selectedSpaceId"
    />
</template>

<script setup lang="ts">
import {
    SettingsIcon,
    CirclePlusIcon,
    ShieldCheck,
    NotebookTabsIcon,
    UsersIcon,
    FolderPlusIcon,
} from "lucide-vue-next";


import { useTone } from "@/store/toneStore";
import { useLocale } from "@/store/localeStore";
import { useMe } from "@/store/meStore";
import { useWindow } from "@/store/windowStore";
import { usePexStore } from "@/store/permissionStore";
import { shallowRef, onUnmounted } from "vue";
import AddChannel from "./modals/AddChannel.vue";
import AddChannelGroup from "./modals/AddChannelGroup.vue";

const { t } = useLocale();
const selectedSpaceId = defineModel<string>('selectedSpace', {
    type: String, required: true
})

const me = useMe();
const windows = useWindow();
const addChannelOpened = shallowRef(false);
const addGroupOpened = shallowRef(false);
const pex = usePexStore();

async function openServerSettings() {
    windows.serverSettingsOpen = true;
}

onUnmounted(() => {
    addChannelOpened.value = false;
    addGroupOpened.value = false;
});
</script>

<style scoped>
.control-bar {
    background-color: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 15px;
    padding: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    position: relative;
}

.controls button {
    background: none;
    border: none;
    color: hsl(var(--foreground));
    font-size: 16px;
    cursor: pointer;
    margin-left: 5px;
    transition: color 0.3s;
    margin: 5px;
}

.controls {
    justify-content: center;
    display: flex;
    gap: 1rem;
    flex: auto;
}

.controls button:hover {
    color: hsl(var(--primary));
}

.controls button.active {
    color: #f04747;
}

.controls button:disabled {
    color: hsl(var(--muted-foreground));
    cursor: not-allowed;
}
</style>