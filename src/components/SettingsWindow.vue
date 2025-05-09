<template>
    <Drawer :open="windows.settingsOpen" :dismissible="false">
        <DrawerContent class="sm:min-h-[95%] h-2 p-4 sm:px-40">
            <DrawerHeader class="flex items-center justify-between">
                <div>
                    <DrawerTitle>{{ t("settings") }}</DrawerTitle>
                    <DrawerDescription>{{ t("manage_settings") }}</DrawerDescription>
                </div>
                <button @click="windows.settingsOpen = false" class="close-button">
                    <CircleXIcon class="w-10 h-10" />
                </button>
            </DrawerHeader>

            <div class="settings-layout justify-center flex min-h-full space-x-4">
                <nav class="settings-nav w-1/6 p-4 text-white space-y-2 rounded-lg">
                    <Button v-for="category in categories" :key="category.id"
                        :variant="selectedCategory !== category.id ? 'ghost' : 'default'"
                        @click="selectedCategory = category.id" class="nav-item px-4 py-2 rounded-md">
                        {{ t(category.id) }}
                    </Button>
                </nav>
                <div
                    class="settings-content w-1/2 p-6 text-white overflow-y-auto max-h-[80vh] scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
                    <component :is="selectedCategoryComponent" />
                </div>

            </div>
        </DrawerContent>
    </Drawer>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { useWindow } from '@/store/windowStore';
import { CircleXIcon } from 'lucide-vue-next';
import VoiceVideoSettings from '@/components/settings/VoiceAndVideo.vue';
import ProfileSettings from '@/components/settings/ProfileSettings.vue';
import ConnectedDevices from '@/components/settings/ConnectedDevices.vue';
import ApplicationSettings from './settings/ApplicationSettings.vue';
import HotKeySettings from './settings/HotKeySettings.vue';
import LanguageSettings from './settings/LanguageSettings.vue';
import SoundSettings from './settings/SoundSettings.vue';
import SocialSettings from './settings/SocialSettings.vue';
import { useLocale } from '@/store/localeStore';
const { t } = useLocale();
const windows = useWindow();

const categories = ref([
    { id: 'account' },
    //{ id: 'appearance', name: 'Appearance' },
    { id: 'application' },
    //{ id: 'notifications', name: 'Notifications' },
    //{ id: 'privacy', name: 'Privacy' },
    //{ id: 'devices', name: 'Devices' },
    { id: 'voice_video' },
    { id: 'hotkeys' },
    { id: 'languages' },
    { id: 'sounds' },
    { id: "socials" }
]);

const selectedCategory = ref('account');

const categoryComponents = {
    account: ProfileSettings,
    devices: ConnectedDevices,
    voice_video: VoiceVideoSettings,
    application: ApplicationSettings,
    hotkeys: HotKeySettings,
    languages: LanguageSettings,
    sounds: SoundSettings,
    socials: SocialSettings
};

const selectedCategoryComponent = computed(() => (categoryComponents as any)[selectedCategory.value]);

const handleEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && windows.settingsOpen) {
        windows.settingsOpen = false;
    }
};

onMounted(() => {
    window.addEventListener('keydown', handleEscape);
});

onUnmounted(() => {
    window.removeEventListener('keydown', handleEscape);
});
</script>

<style scoped>
.settings-layout {
    height: 100%;
}

.settings-nav {
    display: flex;
    flex-direction: column;
}

.nav-item {
    text-align: left;
}

.active-nav {
    color: #ffffff;
    background-color: #4b5563;
}

.settings-content {
    border-left: 1px solid rgba(255, 255, 255, 0.1);
}

.close-button {
    background: none;
    border: none;
    font-size: 1.5rem;
    color: #9ca3af;
    cursor: pointer;
    transition: color 0.2s ease;
}

.close-button:hover {
    color: #f87171;
}


</style>