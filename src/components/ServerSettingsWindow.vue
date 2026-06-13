<template>
    <Drawer :open="windows.serverSettingsOpen" :dismissible="false">
        <DrawerContent class="sm:min-h-[95%] h-2 p-4 sm:px-40" :trap-focus="false" :auto-focus="false">
            <DrawerHeader class="grid grid-cols-[1fr_auto] items-start gap-4">
                <div>
                    <DrawerTitle>{{ t("settings") }}</DrawerTitle>
                    <DrawerDescription>{{ t("manage_settings") }}</DrawerDescription>
                </div>

                <button @click="windows.serverSettingsOpen = false" class="close-button">
                    <CircleXIcon class="w-10 h-10" />
                </button>
            </DrawerHeader>

            <div class="settings-layout justify-center flex flex-1 space-x-4">
                <nav class="settings-nav flex-shrink-0 w-48 p-3 text-white space-y-1 rounded-lg isolate">
                    <button
                        v-for="category in categories"
                        :key="category.id"
                        @click="selectedCategory = category.id"
                        class="nav-item"
                        :class="{ 'nav-item--active': selectedCategory === category.id }"
                    >
                        <component :is="category.icon" class="w-4 h-4 shrink-0" />
                        <span>{{ category.label }}</span>
                    </button>
                </nav>
                <div class="settings-content flex-1 p-6 pb-8 text-white overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
                    <component :is="selectedCategoryComponent" />
                </div>
            </div>
        </DrawerContent>
    </Drawer>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerDescription,
} from "@argon/ui/drawer";
import { CircleXIcon, UserIcon, LinkIcon, ShieldIcon, BotIcon } from "lucide-vue-next";
import { useWindow } from "@/store/ui/windowStore";
import { usePexStore } from "@/store/data/permissionStore";
import Invites from "@/components/settings/Invites.vue";
import RolesSettings from "./settings/spaces/RolesSettings.vue";
import ServerProfile from "./settings/spaces/ServerProfile.vue";
import BotsSettings from "./settings/spaces/BotsSettings.vue";
import { useLocale } from "@/store/system/localeStore";

const windows = useWindow();
const pex = usePexStore();
const { t } = useLocale();

// Each category declares the permission required to see it, so the nav adapts
// to what the current member is actually allowed to manage.
const allCategories = [
    { id: "profile", label: "Profile", icon: UserIcon, perm: "ManageServer", component: ServerProfile },
    { id: "invites", label: "Invites", icon: LinkIcon, perm: "ManageServer", component: Invites },
    { id: "archetypes", label: "Roles", icon: ShieldIcon, perm: "ManageArchetype", component: RolesSettings },
    { id: "bots", label: "Bots", icon: BotIcon, perm: "ManageBots", component: BotsSettings },
] as const;

const categories = computed(() => allCategories.filter((c) => pex.has(c.perm)));

const selectedCategory = ref<string>("profile");

const selectedCategoryComponent = computed(
    () => categories.value.find((c) => c.id === selectedCategory.value)?.component ?? null,
);

// Keep the selection valid as permissions/categories resolve (e.g. a bots-only
// admin opening settings should land on the Bots tab, not an empty Profile tab).
watch(
    categories,
    (list) => {
        if (list.length && !list.some((c) => c.id === selectedCategory.value))
            selectedCategory.value = list[0].id;
    },
    { immediate: true },
);

const handleEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && windows.serverSettingsOpen) {
        windows.serverSettingsOpen = false;
    }
};

onMounted(() => {
    window.addEventListener("keydown", handleEscape);
});

onUnmounted(() => {
    window.removeEventListener("keydown", handleEscape);
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
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.9rem;
    color: hsl(0 0% 100% / 0.7);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}

.nav-item:hover {
    background: hsl(0 0% 100% / 0.06);
    color: #fff;
}

.nav-item--active {
    background: hsl(0 0% 100% / 0.1);
    color: #fff;
}

.settings-content {
    border-left: 1px solid rgba(255, 255, 255, 0.1);
}

/* Bottom spacer so the last card can be fully scrolled into view. */
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
    transition: color 0.2s ease;
}

.close-button:hover {
    color: #f87171;
}
</style>
