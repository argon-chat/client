<template>
    <div class="channel-chat flex flex-col h-full">
        <div v-if="!noMessageChannel" class="messages flex-1 overflow-y-auto p-4 space-y-4 rounded-t-lg">
            <div v-for="(msg, index) in messages" :key="index" class="message">
                <p class="text-gray-400 text-sm">{{ msg.user }}</p>
                <p class="text-white">{{ msg.text }}</p>
            </div>
        </div>
        <div v-if="noMessageChannel" class="flex flex-1 flex-col items-center justify-center text-center space-y-2">
            <div class="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <RadioIcon class="h-10 w-10 text-muted-foreground"/>
                <h3 class="mt-4 text-lg font-semibold">No Text Channel</h3>
                <p class="mb-4 mt-2 text-sm text-muted-foreground">You dont have access to any text channel or there are none in this server.</p>
            </div>
        </div>
        <div v-if="!noMessageChannel" class="message-input p-4 rounded-b-lg flex items-center space-x-3">
            <Textarea v-model="newMessage" placeholder="Type your message here." />
            <Button @click="sendMessage" size="lg" variant="outline">
                <Send class="w-5 h-5 text-gray-400" />
            </Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
    Send,
    RadioIcon
} from 'lucide-vue-next';

type pinus = {
    user: string;
    text: string;
}
const messages = ref(new Array<pinus>());

const newMessage = ref('');
const noMessageChannel = ref(false);

const sendMessage = () => {
    if (!newMessage.value) {
        return;
    }
    console.log(newMessage.value);
    
    if (newMessage.value.trim() !== '') {
        messages.value.push({ user: 'You', text: newMessage.value });
        newMessage.value = '';
    }
};
</script>

<style scoped>
.hover\:bg-gray-700:hover {
    border-radius: 5px;
}
</style>