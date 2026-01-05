<template>
    <div v-bind="$attrs" class="flex flex-col h-full overflow-hidden">
        <div class="w-full max-w-[90rem] mx-auto p-6 space-y-4 h-full flex flex-col">
            <!-- Hero Section -->
            <div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 via-primary/10 to-transparent p-6 border border-primary/20">
                <div class="relative z-10 flex items-center justify-between">
                    <div>
                        <h1 class="text-2xl font-bold mb-1">{{ t('welcome_back') }}, {{ me.me?.displayName }}! 👋</h1>
                        <p class="text-muted-foreground text-sm">{{ t('ready_to_chat') }}</p>
                    </div>
                    
                    <div class="flex gap-2">
                        <button 
                            @click="widgetStore.toggleEditMode()"
                            :class="[
                                'px-4 py-2 rounded-lg transition-all flex items-center gap-2 text-sm font-medium',
                                widgetStore.isEditMode 
                                    ? 'bg-primary text-primary-foreground shadow-lg' 
                                    : 'bg-card hover:bg-accent border border-border'
                            ]">
                            <IconEdit class="w-4 h-4" />
                            {{ widgetStore.isEditMode ? t('done') : t('customize') }}
                        </button>
                        <button 
                            v-if="widgetStore.isEditMode"
                            @click="widgetStore.resetLayout()"
                            class="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-all flex items-center gap-2 text-sm font-medium">
                            <IconRefresh class="w-4 h-4" />
                            {{ t('reset') }}
                        </button>
                    </div>
                </div>
                
                <!-- Decorative elements -->
                <div class="absolute top-0 right-0 w-48 h-48 bg-primary/5 rounded-full blur-3xl pointer-events-none"></div>
                <div class="absolute bottom-0 left-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none"></div>
            </div>

            <!-- Widget Grid -->
            <div class="flex-1 min-h-0">
                <grid-layout
                    v-model:layout="widgetStore.layout"
                    :col-num="3"
                    :row-height="120"
                    :is-draggable="widgetStore.isEditMode"
                    :is-resizable="widgetStore.isEditMode"
                    :responsive="false"
                    :vertical-compact="true"
                    :use-css-transforms="true"
                    :margin="[16, 16]"
                    class="h-full"
                >
                    <grid-item
                        v-for="item in widgetStore.layout"
                        :key="item.i"
                        :x="item.x"
                        :y="item.y"
                        :w="item.w"
                        :h="item.h"
                        :i="item.i"
                        :min-w="item.minW"
                        :min-h="item.minH"
                        :max-w="item.maxW"
                        :max-h="item.maxH"
                        :class="['widget-grid-item', widgetStore.isEditMode && 'edit-mode']"
                    >
                        <div class="shell-item p-4 h-full">
                            <component :is="getWidgetComponent(item.i)" />
                        </div>
                    </grid-item>
                </grid-layout>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useLocale } from '@/store/localeStore';
import { useMe } from '@/store/meStore';
import { useWidgetStore } from '@/store/widgetStore';
import { GridLayout, GridItem } from 'grid-layout-plus';
import { IconEdit, IconRefresh } from '@tabler/icons-vue';

// Widget components
import ActiveNowWidget from '@/components/home/widgets/ActiveNowWidget.vue';
import RecentSpacesWidget from '@/components/home/widgets/RecentSpacesWidget.vue';
import DailyStatsWidget from '@/components/home/widgets/DailyStatsWidget.vue';
import LevelWidget from '@/components/home/widgets/LevelWidget.vue';
import VoiceControlWidget from '@/components/home/widgets/VoiceControlWidget.vue';
import QuickJoinWidget from '@/components/home/widgets/QuickJoinWidget.vue';

const { t } = useLocale();
const me = useMe();
const widgetStore = useWidgetStore();

defineOptions({ inheritAttrs: false });

const getWidgetComponent = (widgetId: string | number) => {
    const id = String(widgetId);
    const components: Record<string, any> = {
        'active-now': ActiveNowWidget,
        'recent-spaces': RecentSpacesWidget,
        'daily-stats': DailyStatsWidget,
        'level': LevelWidget,
        'voice-control': VoiceControlWidget,
        'quick-join': QuickJoinWidget,
    };
    return components[id];
};
</script>

<style lang="css" scoped>
.shell-item {
    background-color: hsl(var(--card));
    border-radius: 15px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    border: 1px solid hsl(var(--border) / 0.5);
    transition: all 0.3s ease;
}

.shell-item:hover {
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
}

.widget-grid-item.edit-mode .shell-item {
    cursor: move;
    border-color: hsl(var(--primary) / 0.3);
}

.widget-grid-item.edit-mode .shell-item:hover {
    border-color: hsl(var(--primary) / 0.5);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

@keyframes shimmer {
    0% {
        transform: translateX(-100%);
    }
    100% {
        transform: translateX(100%);
    }
}

.animate-shimmer {
    animation: shimmer 2s infinite;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
}

@keyframes pulse-fast {
    0%, 100% {
        opacity: 1;
    }
    50% {
        opacity: 0.5;
    }
}

.animate-pulse-fast {
    animation: pulse-fast 0.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes wave {
    0% {
        transform: translateX(0);
    }
    100% {
        transform: translateX(-50%);
    }
}

.animate-wave {
    animation: wave 3s linear infinite;
}

/* grid-layout-plus overrides */
:deep(.vue-grid-layout) {
    background: transparent;
}

:deep(.vue-grid-item) {
    transition: all 0.2s ease;
    border-radius: 12px;
}

:deep(.vue-grid-item.vue-grid-placeholder) {
    background: hsl(var(--primary) / 0.1);
    border: 2px dashed hsl(var(--primary) / 0.3);
    border-radius: 15px;
    z-index: 2;
    transition: all 0.2s;
}

:deep(.vue-grid-item.vue-draggable-dragging) {
    transition: none;
    z-index: 3;
    opacity: 0.9;
}

:deep(.vue-grid-item > .vue-resizable-handle) {
    opacity: 0;
    transition: opacity 0.2s;
}

:deep(.vue-grid-item:hover > .vue-resizable-handle) {
    opacity: 1;
}
</style>
