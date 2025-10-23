<template>
    <div class="relative" style="z-index: 1;" v-if="me.me" v-show="pex.has('ManageServer')">
        <div class="control-bar">
            <div class="controls">
                <button @click="openServerSettings">
                    <SettingsIcon class="w-5 h-5" />
                </button>
                <button @click="addChannelOpened = true">
                    <CirclePlusIcon class="w-5 h-5" />
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
      @close="addChannelOpened = false"
    />
</template>

<script setup lang="ts">
import {
    SettingsIcon,
    CirclePlusIcon,
    ShieldCheck,
    NotebookTabsIcon,
    UsersIcon,
} from "lucide-vue-next";
import { useMe } from "@/store/meStore";
import { useWindow } from "@/store/windowStore";
import { usePexStore } from "@/store/permissionStore";
import { ref } from "vue";
import AddChannel from "./modals/AddChannel.vue";

const selectedSpaceId = defineModel<string>('selectedSpace', {
    type: String, required: true
})

const me = useMe();
const windows = useWindow();
const addChannelOpened = ref(false);
const pex = usePexStore();
async function openServerSettings() {
    windows.serverSettingsOpen = true;
}
</script>

<style scoped>
.control-bar {
    background-color: #161616;
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
    color: #fff;
    font-size: 16px;
    cursor: pointer;
    margin-left: 5px;
    transition: color 0.3s;
    margin: 5px;
}

.controls {
    justify-content: center;
    display: flex;
    gap: 6px;
    flex: auto;
}

.controls button:hover {
    color: #5865f2;
}

.controls button.active {
    color: #f04747;
}

.controls button:disabled {
    color: #4d4c4c;
    cursor: not-allowed;
}
</style>