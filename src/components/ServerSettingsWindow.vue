<template>
    <Drawer :open="windows.serverSettingsOpen" :dismissible="false">
        <DrawerContent class="sm:min-h-[95%] h-2 p-4 sm:px-40" :trap-focus="false" :auto-focus="false">
            <DrawerHeader class="grid grid-cols-[1fr_auto] items-start gap-4">
                <div>
                    <DrawerTitle>{{ t("settings") }}</DrawerTitle>
                    <DrawerDescription>{{ t("manage_settings") }}</DrawerDescription>
                </div>

                <button @click="windows.serverSettingsOpen = false" class="close-button icon-motion icon-motion--pop">
                    <CircleXIcon class="w-10 h-10" />
                </button>
            </DrawerHeader>

            <div class="settings-layout justify-center flex flex-1 space-x-4">
                <nav class="settings-nav flex-shrink-0 w-48 p-3 space-y-1 rounded-lg isolate">
                    <button
                        v-for="category in categories"
                        :key="category.id"
                        @click="selectedCategory = category.id"
                        class="nav-item"
                        :class="{ 'nav-item--active': selectedCategory === category.id }"
                    >
                        <component :is="category.icon" class="w-4 h-4 shrink-0" />
                        <span>{{ t(category.labelKey) }}</span>
                    </button>
                </nav>
                <div class="settings-content flex-1 p-6 pb-8 text-foreground overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
                    <TabTransition>
                        <component :is="selectedCategoryComponent" :key="selectedCategory" />
                    </TabTransition>
                </div>
            </div>
        </DrawerContent>
    </Drawer>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, type Component } from "vue";
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerDescription,
} from "@argon/ui/drawer";
import { CircleXIcon, UserIcon, LinkIcon, ShieldIcon, BotIcon, SmilePlusIcon } from "lucide-vue-next";
import { useWindow, type ServerSettingsCategory } from "@/store/ui/windowStore";
import { usePexStore } from "@/store/data/permissionStore";
import type { ArgonEntitlementFlag } from "@/lib/rbac/ArgonEntitlement";
import Invites from "@/components/settings/Invites.vue";
import RolesSettings from "./settings/spaces/RolesSettings.vue";
import ServerProfile from "./settings/spaces/ServerProfile.vue";
import BotsSettings from "./settings/spaces/BotsSettings.vue";
import ExpressionsSettings from "./settings/spaces/ExpressionsSettings.vue";
import TabTransition from "@/components/shared/TabTransition.vue";
import { useLocale } from "@/store/system/localeStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";

const windows = useWindow();
const pex = usePexStore();
const features = useFeatureFlags();
const { t } = useLocale();

// Each category declares the permission required to see it, so the nav adapts
// to what the current member is actually allowed to manage.
// `perm` may list several flags: any one of them shows the category.
// `feature`, when set, hides the category until that feature is on.
type Category = {
    id: ServerSettingsCategory;
    labelKey: string;
    icon: Component;
    perm: ArgonEntitlementFlag | readonly ArgonEntitlementFlag[];
    feature?: () => boolean;
    component: Component;
};

const allCategories: readonly Category[] = [
    { id: "profile", labelKey: "profile", icon: UserIcon, perm: "ManageServer", component: ServerProfile },
    { id: "invites", labelKey: "server_settings_nav_invites", icon: LinkIcon, perm: "ManageServer", component: Invites },
    { id: "archetypes", labelKey: "server_settings_nav_roles", icon: ShieldIcon, perm: "ManageArchetype", component: RolesSettings },
    {
        id: "expressions",
        labelKey: "expression_settings_nav",
        icon: SmilePlusIcon,
        perm: ["CreateExpressions", "ManageExpressions"],
        feature: () => !!features.stickersAndEmojiActive,
        component: ExpressionsSettings,
    },
    { id: "bots", labelKey: "server_settings_nav_bots", icon: BotIcon, perm: "ManageBots", component: BotsSettings },
];

const categories = computed(() =>
    allCategories.filter(
        (c) =>
            (c.feature?.() ?? true) &&
            (typeof c.perm === "string" ? [c.perm] : c.perm).some((flag) => pex.has(flag)),
    ),
);

const selectedCategory = ref<ServerSettingsCategory>("profile");

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

// Opened at a section (openServerSettings): taken once the member's permissions show it.
watch(
    [() => windows.serverSettingsOpen, () => windows.serverSettingsCategory, categories],
    ([open, wanted, list]) => {
        if (!open) {
            windows.serverSettingsCategory = null;
            return;
        }
        if (!wanted || !list.some((c) => c.id === wanted)) return;
        selectedCategory.value = wanted;
        windows.serverSettingsCategory = null;
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
    color: hsl(var(--muted-foreground));
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}

.nav-item:hover {
    background: hsl(var(--accent) / 0.6);
    color: hsl(var(--foreground));
}

.nav-item--active {
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
}

.settings-content {
    border-left: 1px solid hsl(var(--border));
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
