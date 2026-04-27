<template>
    <div v-bind="$attrs" class="flex flex-col h-full overflow-hidden">
        <div class="w-full max-w-[90rem] mx-auto p-5 h-full flex flex-col gap-4">
            <!-- Compact greeting bar -->
            <div class="greeting-bar flex items-center justify-between px-4 py-3 rounded-xl">
                <div>
                    <h1 class="text-lg font-semibold">{{ t('welcome_back') }}, {{ me.me?.displayName }} 👋</h1>
                    <p class="text-muted-foreground text-xs mt-0.5">{{ t('ready_to_chat') }}</p>
                </div>
                <div class="flex gap-2">
                    <button
                        @click="widgetStore.toggleEditMode()"
                        :class="[
                            'px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 text-xs font-medium',
                            widgetStore.isEditMode
                                ? 'bg-primary text-primary-foreground shadow-md'
                                : 'bg-accent/50 hover:bg-accent border border-border/50 text-foreground'
                        ]">
                        <IconEdit class="w-3.5 h-3.5" />
                        {{ widgetStore.isEditMode ? t('done') : t('customize') }}
                    </button>
                    <button
                        v-if="widgetStore.isEditMode"
                        @click="widgetStore.resetLayout()"
                        class="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-all flex items-center gap-1.5 text-xs font-medium">
                        <IconRefresh class="w-3.5 h-3.5" />
                        {{ t('reset') }}
                    </button>
                </div>
            </div>

            <!-- Widget Grid -->
            <div class="flex-1 min-h-0">
                <grid-layout
                    v-model:layout="widgetStore.layout"
                    :col-num="3"
                    :row-height="60"
                    :is-draggable="widgetStore.isEditMode"
                    :is-resizable="widgetStore.isEditMode"
                    :responsive="false"
                    :vertical-compact="true"
                    :use-css-transforms="true"
                    :margin="[12, 12]"
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
                        <div class="widget-card p-4 h-full">
                            <component :is="getWidgetComponent(item.i)" />
                        </div>
                    </grid-item>
                </grid-layout>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useLocale } from '@/store/system/localeStore';
import { useMe } from '@/store/auth/meStore';
import { useWidgetStore } from '@/store/ui/widgetStore';
import { GridLayout, GridItem } from 'grid-layout-plus';
import { IconEdit, IconRefresh } from '@tabler/icons-vue';

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
.greeting-bar {
    background-color: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
}

.widget-card {
    background-color: hsl(var(--card));
    border-radius: 15px;
    border: 1px solid hsl(var(--border) / 0.5);
    transition: box-shadow 0.2s ease;
}

.widget-card:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.widget-grid-item.edit-mode {
    user-select: none;
}

.widget-grid-item.edit-mode .widget-card {
    cursor: move;
    border-color: hsl(var(--primary) / 0.3);
}

.widget-grid-item.edit-mode .widget-card:hover {
    border-color: hsl(var(--primary) / 0.5);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
}

@keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}

.animate-shimmer {
    animation: shimmer 2s infinite;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
}

@keyframes pulse-fast {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.animate-pulse-fast {
    animation: pulse-fast 0.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
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
