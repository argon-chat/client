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
    <div class="p-4 border-t border-border flex items-center gap-2 bg-card">
        <input v-model="inputText" disabled placeholder="Write a message..."
            class="flex-1 bg-background text-sm text-foreground px-3 py-2 rounded-lg border border-border disabled:cursor-not-allowed disabled:opacity-50"
            @keyup.enter="sendMessage" />
        <button disabled @click="sendMessage" class="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed">
            Send
        </button>
    </div>
</template>
