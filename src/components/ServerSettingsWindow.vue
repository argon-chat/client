<template>
    <Drawer :open="windows.serverSettingsOpen" :dismissible="false">
        <DrawerContent class="sm:min-h-[95%] h-2 p-4 sm:px-40">
            <DrawerHeader class="flex items-center justify-between">
                <div>
                    <DrawerTitle>Settings</DrawerTitle>
                    <DrawerDescription>Manage your server and preferences</DrawerDescription>
                </div>
                <button @click="windows.serverSettingsOpen = false" class="close-button">
                    <CircleXIcon class="w-10 h-10" />
                </button>
            </DrawerHeader>

            <div class="settings-layout justify-center flex min-h-full space-x-4">
                <nav class="settings-nav w-1/6 p-4 text-white space-y-2 rounded-lg">
                    <Button v-for="category in categories" :key="category.id"
                        :variant=" selectedCategory !== category.id ? 'ghost' : 'default'"
                        @click="selectedCategory = category.id" class="nav-item px-4 py-2 rounded-md">
                        {{ category.name }}
                    </Button>
                </nav>
                <div class="settings-content w-1/2 p-6  text-white ">
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
import Invites from '@/components/settings/Invites.vue';

const windows = useWindow();

const categories = ref([
    { id: 'server', name: 'Server' },
    { id: 'archetypes', name: 'Archetypes' },
    { id: 'invites', name: 'Invites' },
]);

const selectedCategory = ref('account');

const categoryComponents = {
    server: Invites,
    archetypes: Invites,
    invites: Invites
};

const selectedCategoryComponent = computed(() => (categoryComponents as any)[selectedCategory.value]);

const handleEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && windows.serverSettingsOpen) {
        windows.serverSettingsOpen = false;
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