<template>
    <Drawer :open="windows.settingsOpen" :dismissible="false">
        <DrawerContent class="sm:min-h-[95%] h-2 p-4 sm:px-40">
            <DrawerHeader class="grid grid-cols-[1fr_auto] items-start gap-4">
                <div class="fade-in">
                    <DrawerTitle>{{ t("settings") }}</DrawerTitle>
                    <DrawerDescription>{{ t("manage_settings") }}</DrawerDescription>
                </div>

                <button 
                    @click="closeSettings" 
                    class="close-button transition-all duration-200 hover:scale-110"
                    aria-label="Close settings"
                >
                    <CircleXIcon class="w-10 h-10" />
                </button>
            </DrawerHeader>

            <div class="settings-layout justify-center flex flex-1 space-x-4">
                <nav class="settings-nav flex-shrink-0 w-48 p-4 text-white space-y-2 rounded-lg isolate">
                    <TransitionGroup name="nav-list" tag="div" class="space-y-2">
                        <Button 
                            v-for="category in visibleCategories" 
                            :key="category.id"
                            :variant="selectedCategory !== category.id ? 'ghost' : 'default'"
                            @click="changeCategory(category.id)" 
                            :disabled="category.disabled"
                            class="nav-item px-4 py-2 rounded-md w-full transition-all duration-200 hover:scale-[1.02] justify-center">
                            {{ t(category.id) }}
                        </Button>
                    </TransitionGroup>
                </nav>
                
                <div class="settings-content flex-1 p-6 pb-8 text-white overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
                    <Transition name="slide-fade" mode="out-in">
                        <component :is="selectedCategoryComponent" :key="selectedCategory" />
                    </Transition>
                </div>
            </div>
        </DrawerContent>
    </Drawer>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerDescription,
} from "@argon/ui/drawer";
import { Button } from "@argon/ui/button";
import { useWindow } from "@/store/windowStore";
import { CircleXIcon } from "lucide-vue-next";
import VoiceVideoSettings from "@/components/settings/VoiceAndVideo.vue";
import ProfileSettings from "@/components/settings/ProfileSettings.vue";
import ConnectedDevices from "@/components/settings/ConnectedDevices.vue";
import ApplicationSettings from "./settings/ApplicationSettings.vue";
import HotKeySettings from "./settings/HotKeySettings.vue";
import LanguageSettings from "./settings/LanguageSettings.vue";
import SoundSettings from "./settings/SoundSettings.vue";
import AppearanceSettings from "./settings/AppearanceSettings.vue";
import { useLocale } from "@/store/localeStore";
import StorageSettings from "./settings/StorageSettings.vue";
import ActivityLog from "./settings/ActivityLog.vue";
import { useConfigStore } from "@/store/configStore";

// Stores
const { t } = useLocale();
const windows = useWindow();
const configStore = useConfigStore();

// State
const selectedCategory = ref("account");

// Category configuration
interface Category {
    id: string;
    disabled?: boolean;
    hidden?: boolean;
}

const CATEGORY_CONFIG: Category[] = [
    { id: "account" },
    { id: "appearance" },
    { id: "application" },
    { id: "voice_video" },
    { id: "hotkeys" },
    { id: "languages" },
    { id: "sounds" },
    { id: "storages" },
    { id: "activity", disabled: false }
];

const categories = computed<Category[]>(() => 
    CATEGORY_CONFIG.map(cat => 
        cat.id === "activity" 
            ? { ...cat, hidden: !configStore.devModeEnabled }
            : cat
    )
);

const visibleCategories = computed(() => 
    categories.value.filter(cat => !cat.hidden)
);

// Component mapping
const categoryComponents: Record<string, any> = {
    account: ProfileSettings,
    devices: ConnectedDevices,
    appearance: AppearanceSettings,
    voice_video: VoiceVideoSettings,
    application: ApplicationSettings,
    hotkeys: HotKeySettings,
    languages: LanguageSettings,
    sounds: SoundSettings,
    storages: StorageSettings,
    activity: ActivityLog
};

const selectedCategoryComponent = computed(
    () => categoryComponents[selectedCategory.value]
);

// Methods
const closeSettings = () => {
    windows.settingsOpen = false;
};

const changeCategory = (categoryId: string) => {
    selectedCategory.value = categoryId;
};

const handleEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && windows.settingsOpen) {
        closeSettings();
    }
};

// Lifecycle
onMounted(() => {
    window.addEventListener("keydown", handleEscape);
});

onUnmounted(() => {
    window.removeEventListener("keydown", handleEscape);
});
</script>

<style scoped>
/* Layout */
.settings-layout {
    height: 100%;
}

.settings-nav {
    display: flex;
    flex-direction: column;
    backface-visibility: hidden;
    overflow: hidden;
    contain: layout paint;
    box-shadow: none;
    border: none;
}

.nav-item {
    text-align: left;
    backface-visibility: hidden;
    box-shadow: none;
    border: none;
}

.settings-content {
    border-left: 1px solid rgba(255, 255, 255, 0.1);
}

.settings-content::after {
    content: '';
    display: block;
    height: 8rem;
}

.close-button {
    background: none;
    border: none;
    font-size: 1.5rem;
    color: #9ca3af;
    cursor: pointer;
}

.close-button:hover {
    color: #f87171;
}

/* Fade in animation */
.fade-in {
    animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateY(-10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* Slide fade transition for content */
.slide-fade-enter-active {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-fade-leave-active {
    transition: all 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.slide-fade-enter-from {
    transform: translateX(20px);
    opacity: 0;
}

.slide-fade-leave-to {
    transform: translateX(-20px);
    opacity: 0;
}

/* Nav list transitions */
.nav-list-move,
.nav-list-enter-active,
.nav-list-leave-active {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.nav-list-enter-from {
    opacity: 0;
    transform: translateX(-30px);
}

.nav-list-leave-to {
    opacity: 0;
    transform: translateX(30px);
}

.nav-list-leave-active {
    position: absolute;
}
</style>