<template>
    <div class="flex flex-col h-full">
        <!-- Voice channel info -->
        <div class="p-3 border-b border-border">
            <h3 class="text-xs font-medium text-foreground mb-1.5">Voice Channel</h3>
            <div v-if="currentChannel" class="text-xs">
                <p class="text-foreground">{{ currentChannel.name }}</p>
                <p class="text-muted-foreground">{{ members.length }} members</p>
            </div>
            <div v-else class="text-xs text-muted-foreground">
                Not connected to voice
            </div>
        </div>

        <!-- Members list -->
        <div class="flex-1 overflow-y-auto p-3">
            <h3 class="text-xs font-medium text-foreground mb-2">Members</h3>
            <div class="space-y-1.5">
                <div 
                    v-for="member in members" 
                    :key="member.userId"
                    class="flex items-center gap-2 p-1.5 rounded-lg bg-card/50"
                    :class="{ 'ring-2 ring-lime-400/50': member.isSpeaking }"
                >
                    <!-- Avatar with image or fallback -->
                    <div class="relative w-7 h-7 rounded-full overflow-hidden flex-shrink-0">
                        <img 
                            v-if="member.avatarUrl"
                            :src="member.avatarUrl"
                            :alt="member.displayName"
                            class="w-full h-full object-cover"
                            @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
                        />
                        <div 
                            v-if="!member.avatarUrl"
                            class="w-full h-full flex items-center justify-center text-white text-xs font-medium"
                            :style="{ backgroundColor: member.avatarColor }"
                        >
                            {{ member.displayName.charAt(0).toUpperCase() }}
                        </div>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs text-foreground truncate">{{ member.displayName }}</p>
                        <div class="flex gap-1 text-[10px] text-muted-foreground">
                            <span v-if="member.isSpeaking" class="text-lime-400">Speaking</span>
                            <span v-if="member.isMuted" class="text-red-400">Muted</span>
                            <span v-if="member.isDeafened" class="text-red-400">Deafened</span>
                        </div>
                    </div>
                </div>
                
                <div v-if="members.length === 0" class="text-xs text-muted-foreground text-center py-3">
                    No members in voice
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { VoiceMember } from '@/lib/overlay'

defineProps<{
    currentChannel: { name: string } | null
    members: VoiceMember[]
}>()
</script>
