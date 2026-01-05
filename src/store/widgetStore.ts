import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { LayoutItem } from 'grid-layout-plus';

export type WidgetLayout = LayoutItem;

export const useWidgetStore = defineStore('widgets', () => {
    // Default layout configuration
    const defaultLayout: WidgetLayout[] = [
        { i: 'active-now', x: 0, y: 0, w: 1, h: 2, minW: 1, minH: 2, maxW: 2, maxH: 4 },
        { i: 'recent-spaces', x: 0, y: 2, w: 1, h: 2, minW: 1, minH: 2, maxW: 2, maxH: 4 },
        { i: 'daily-stats', x: 1, y: 0, w: 1, h: 2, minW: 1, minH: 2, maxW: 2, maxH: 3 },
        { i: 'level', x: 2, y: 0, w: 1, h: 0.5, minW: 1, minH: 0.5, maxW: 1, maxH: 0.5, isResizable: false },
        { i: 'voice-control', x: 2, y: 0.5, w: 1, h: 2, minW: 1, minH: 2, maxW: 2, maxH: 3 },
        { i: 'quick-join', x: 2, y: 2.5, w: 1, h: 1, minW: 1, minH: 1, maxW: 2, maxH: 2 },
    ];

    const layout = ref<WidgetLayout[]>([]);
    const isEditMode = ref(false);

    // Load layout from localStorage or use default
    const loadLayout = () => {
        const savedLayout = localStorage.getItem('dashboard-layout');
        if (savedLayout) {
            try {
                layout.value = JSON.parse(savedLayout);
            } catch (e) {
                layout.value = [...defaultLayout];
            }
        } else {
            layout.value = [...defaultLayout];
        }
    };

    // Save layout to localStorage
    const saveLayout = () => {
        localStorage.setItem('dashboard-layout', JSON.stringify(layout.value));
    };

    // Update layout
    const updateLayout = (newLayout: WidgetLayout[]) => {
        layout.value = newLayout;
        saveLayout();
    };

    // Reset to default layout
    const resetLayout = () => {
        layout.value = [...defaultLayout];
        saveLayout();
    };

    // Toggle edit mode
    const toggleEditMode = () => {
        isEditMode.value = !isEditMode.value;
    };

    // Initialize on store creation
    loadLayout();

    return {
        layout,
        isEditMode,
        updateLayout,
        resetLayout,
        toggleEditMode,
        loadLayout,
    };
});
