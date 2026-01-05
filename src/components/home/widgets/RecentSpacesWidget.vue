<template>
    <div class="widget-container h-full flex flex-col">
        <div class="flex items-center justify-between mb-3">
            <h2 class="flex items-center gap-2 text-sm font-semibold">
                <div class="p-1.5 rounded-lg bg-primary/10">
                    <IconHistory class="w-4 h-4 text-primary" />
                </div>
                {{ t('recent_spaces') }}
            </h2>
            <button @click="toggleView" class="p-1 rounded hover:bg-accent/50 transition-colors">
                <IconLayoutGrid v-if="viewMode === 'list'" class="w-4 h-4 text-muted-foreground" />
                <IconList v-else class="w-4 h-4 text-muted-foreground" />
            </button>
        </div>
        
        <div class="overflow-y-auto flex-1">
            <!-- Empty state -->
            <div v-if="sortedSpaces.length === 0" class="flex flex-col items-center justify-center h-full text-center">
                <div class="mb-2 p-2 rounded-full bg-muted/50">
                    <IconClock class="w-6 h-6 text-muted-foreground/50" />
                </div>
                <p class="text-muted-foreground text-xs mb-1">{{ t('no_recent_spaces') }}</p>
            </div>
            
            <!-- List view -->
            <div v-else-if="viewMode === 'list'" class="space-y-2">
                <div v-for="space in sortedSpaces" :key="space.id"
                    class="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 transition-all group relative">
                    <button 
                        @click.stop="togglePinSpace(space.id)"
                        class="absolute top-1 right-1 p-1 rounded hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity z-10"
                        :class="{ '!opacity-100': space.isPinned }"
                    >
                        <IconPinFilled v-if="space.isPinned" class="w-3 h-3 text-primary" />
                        <IconPin v-else class="w-3 h-3 text-muted-foreground" />
                    </button>
                    
                    <div @click="goToSpace(space.id)" class="flex items-center gap-2 flex-1 cursor-pointer">
                        <div v-if="space.avatarFieldId" class="w-8 h-8 rounded-lg overflow-hidden shrink-0">
                            <img :src="space.avatarFieldId" :alt="space.name" class="w-full h-full object-cover" />
                        </div>
                        <div v-else class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center font-bold text-primary text-xs shrink-0">
                            {{ space.name[0] }}
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="font-medium text-xs truncate">{{ space.name }}</p>
                            <span v-if="space.onlineCount > 0" class="text-[10px] text-green-500">{{ space.onlineCount }} online</span>
                            <span v-else class="text-[10px] text-muted-foreground">{{ space.isPinned ? t('pinned') : t('recent') }}</span>
                        </div>
                        <IconChevronRight class="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                </div>
            </div>
            
            <!-- Grid view -->
            <div v-else class="grid grid-cols-2 gap-2">
                <div v-for="space in sortedSpaces" :key="space.id"
                    class="relative group">
                    <button 
                        @click.stop="togglePinSpace(space.id)"
                        class="absolute top-1 right-1 p-1 rounded-full bg-card/80 backdrop-blur-sm hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity z-10"
                        :class="{ '!opacity-100': space.isPinned }"
                    >
                        <IconPinFilled v-if="space.isPinned" class="w-3 h-3 text-primary" />
                        <IconPin v-else class="w-3 h-3 text-muted-foreground" />
                    </button>
                    
                    <div @click="goToSpace(space.id)" 
                        class="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-accent/50 transition-all cursor-pointer">
                        <div v-if="space.avatarFieldId" class="w-12 h-12 rounded-lg overflow-hidden">
                            <img :src="space.avatarFieldId" :alt="space.name" class="w-full h-full object-cover" />
                        </div>
                        <div v-else class="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center font-bold text-primary text-sm">
                            {{ space.name[0] }}
                        </div>
                        <div class="text-center w-full">
                            <p class="font-medium text-xs truncate">{{ space.name }}</p>
                            <span v-if="space.onlineCount > 0" class="text-[10px] text-green-500">{{ space.onlineCount }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useLocale } from '@/store/localeStore';
import { IconHistory, IconClock, IconChevronRight, IconLayoutGrid, IconList, IconPin, IconPinFilled } from '@tabler/icons-vue';
import { computed, ref, watch } from 'vue';
import { useRecentSpaces, getViewMode, setViewMode } from '@/lib/recentSpaces';
import { useRouter } from 'vue-router';

const { t } = useLocale();
const router = useRouter();
const { recentSpaces, togglePin } = useRecentSpaces();

const viewMode = ref<'list' | 'grid'>(getViewMode());

// Save view mode when it changes
watch(viewMode, (newMode) => {
    setViewMode(newMode);
});

const recentSpacesList = computed(() => {
    return recentSpaces.value.map(space => ({
        id: space.spaceId,
        name: space.name,
        avatarFieldId: space.avatarFieldId,
        isPinned: space.isPinned || false,
        // TODO: Get real online count from space data
        onlineCount: 0
    }));
});

const sortedSpaces = computed(() => {
    return [...recentSpacesList.value].sort((a, b) => {
        // Pinned spaces first
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return 0;
    });
});

function goToSpace(spaceId: string) {
    router.push(`/master.pg/space/${spaceId}`);
}

function toggleView() {
    viewMode.value = viewMode.value === 'list' ? 'grid' : 'list';
}

function togglePinSpace(spaceId: string) {
    togglePin(spaceId);
}
</script>
