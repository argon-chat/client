<script setup lang="ts">
import { useRecentChatsStore } from "@/store/useRecentChatsStore"
import { ref, nextTick } from "vue"
import { useRoute } from "vue-router"

const inputText = ref("")
const route = useRoute()
const recentStore = useRecentChatsStore()

const listEl = defineModel("listEl")

function sendMessage() {
    if (!inputText.value.trim()) return


    inputText.value = ""
}
</script>

<template>
    <div class="p-4 border-t border-white/10 flex items-center gap-2">
        <input v-model="inputText" disabled placeholder="Write a message..."
            class="flex-1 bg-[#1e1e1e] text-sm text-white px-3 py-2 rounded-lg border border-white/10 disabled:cursor-not-allowed"
            @keyup.enter="sendMessage" />
        <button disabled @click="sendMessage" class="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:bg-blue-900 disabled:text-gray-400 disabled:cursor-not-allowed">
            Send
        </button>
    </div>
</template>
