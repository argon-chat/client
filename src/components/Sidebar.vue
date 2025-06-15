<template>
    <div class="flex flex-col items-center justify-between h-full">
        <div class="sidebar">
            <ul>
                <li v-for="server in pool.allServers.value" :key="server.Id"
                    :class="{ 'active-server': server.Id === pool.selectedServer }" >
                    <!-- @click="serverStore.selectServer(server.Id)" -->
                    <div class="server-icon-wrapper">
                        <img :src="server.AvatarFileId" :alt="server.Id" class="server-icon" />
                    </div>
                </li>
            </ul>
            <ul>
                <li class="controls">
                    <button>
                        <PlusCircleIcon class="w-5 h-5" />
                    </button>
                </li>
            </ul>
            <ul style="margin-top: auto !important;">
                <li class="controls">
                    <button>
                    </button>
                </li>
            </ul>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Settings, PlusCircleIcon } from "lucide-vue-next";
import { useWindow } from "@/store/windowStore";
import { usePoolStore } from "@/store/poolStore";
const windows = useWindow();
const pool = usePoolStore();
</script>
<style scoped>

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
}

.controls button:hover {
  color: #5865f2;
}

.controls button.active {
  color: #f04747;
}


.sidebar {
    width: 60px;
    background-color: #161616;
    height: 100%;
    border-radius: 15px;
    padding: 10px 0;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    flex-direction: column;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transition: all 0.3s ease;
}

ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
}

li {
    margin: 10px 0;
    cursor: pointer;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;
}

li:hover {
    background-color: #3b3d42;
}

.active-server .server-icon-wrapper {
    border: 2px solid #5865f2;
}

.server-icon-wrapper {
    width: 25px;
    height: 25px;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;
    box-sizing: border-box;
}

.server-icon {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
</style>