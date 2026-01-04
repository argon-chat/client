<template>
    <div class="space-y-6">
        <h2 class="text-2xl font-bold mb-6">{{ t("appearance") }}</h2>

        <!-- Theme Selection -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <PaletteIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("theme") }}</h3>
            </div>

            <div class="grid grid-cols-3 gap-3">
                <div v-for="theme in themes" :key="theme.id" class="theme-card"
                    :class="{ 'theme-selected': currentTheme === theme.id }" @click="selectTheme(theme.id)">
                    <div class="theme-preview" :style="theme.preview">
                        <div class="theme-preview-top"></div>
                        <div class="theme-preview-sidebar"></div>
                        <div class="theme-preview-content"></div>
                    </div>
                    <div class="text-center mt-2">
                        <div class="text-sm font-medium">{{ theme.name }}</div>
                        <div class="text-xs text-muted-foreground">{{ theme.description }}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Font Settings -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <TypeIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("typography") }}</h3>
            </div>

            <div class="space-y-4">
                <!-- Font Family -->
                <div class="setting-item">
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t("font_family") }}</div>
                        <div class="text-xs text-muted-foreground">{{ t("font_family_desc") }}</div>
                    </div>
                    <Select v-model="fontFamily">
                        <SelectTrigger class="w-[200px]">
                            <SelectValue :placeholder="t('select_font')" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem v-for="font in fonts" :key="font.value" :value="font.value">
                                    <span :style="{ fontFamily: font.value }">{{ font.name }}</span>
                                </SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>

                <!-- Font Size -->
                <div class="setting-item flex-col items-start gap-3">
                    <div class="w-full">
                        <div class="flex items-center justify-between mb-2">
                            <div>
                                <div class="text-sm font-medium">{{ t("font_size") }}</div>
                                <div class="text-xs text-muted-foreground">{{ t("font_size_desc") }}</div>
                            </div>
                            <span class="text-sm font-mono text-primary">{{ fontSize }}px</span>
                        </div>
                        <div class="flex items-center gap-4">
                            <MinusIcon class="w-4 h-4 text-muted-foreground" />
                            <Slider class="flex-1" :min="12" :max="20" :step="1" v-model="fontSizeArray" />
                            <PlusIcon class="w-4 h-4 text-primary" />
                        </div>
                    </div>
                </div>

                <!-- Line Height -->
                <div class="setting-item flex-col items-start gap-3">
                    <div class="w-full">
                        <div class="flex items-center justify-between mb-2">
                            <div>
                                <div class="text-sm font-medium">{{ t("line_height") }}</div>
                                <div class="text-xs text-muted-foreground">{{ t("line_height_desc") }}</div>
                            </div>
                            <span class="text-sm font-mono text-primary">{{ lineHeight.toFixed(1) }}</span>
                        </div>
                        <div class="flex items-center gap-4">
                            <span class="text-xs text-muted-foreground">{{ t("line_height_tight") }}</span>
                            <Slider class="flex-1" :min="1.2" :max="2.0" :step="0.1" v-model="lineHeightArray" />
                            <span class="text-xs text-muted-foreground">{{ t("line_height_loose") }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- UI Density -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <LayoutGridIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("ui_density") }}</h3>
            </div>

            <div class="grid grid-cols-3 gap-3">
                <div v-for="density in densities" :key="density.id" class="density-card"
                    :class="{ 'density-selected': uiDensity === density.id }" @click="uiDensity = density.id">
                    <component :is="density.icon" class="w-8 h-8 mx-auto mb-2 text-primary" />
                    <div class="text-sm font-medium">{{ density.name }}</div>
                    <div class="text-xs text-muted-foreground">{{ density.description }}</div>
                </div>
            </div>
        </div>

        <!-- UI Scale -->
        <!-- TODO: Enable when webview2 zoom control is implemented
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <MaximizeIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">UI Scale</h3>
            </div>

            <div class="setting-item flex-col items-start gap-3">
                <div class="w-full">
                    <div class="flex items-center justify-between mb-2">
                        <div>
                            <div class="text-sm font-medium">Interface Zoom</div>
                            <div class="text-xs text-muted-foreground">Adjust overall interface size (DPI scaling)</div>
                        </div>
                        <span class="text-sm font-mono text-primary">{{ uiScale }}%</span>
                    </div>
                    <div class="flex items-center gap-4">
                        <span class="text-xs text-muted-foreground">80%</span>
                        <Slider 
                            class="flex-1" 
                            :min="80" 
                            :max="125" 
                            :step="5" 
                            v-model="uiScaleArray" 
                        />
                        <span class="text-xs text-muted-foreground">125%</span>
                    </div>
                    <div class="mt-2 text-xs text-muted-foreground text-center">
                        💡 Useful for high-DPI displays or accessibility needs
                    </div>
                </div>
            </div>
        </div>
        -->

        <!-- Border Radius -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <CircleDotIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("border_radius") }}</h3>
            </div>

            <div class="setting-item flex-col items-start gap-3">
                <div class="w-full">
                    <div class="flex items-center justify-between mb-2">
                        <div class="text-xs text-muted-foreground">{{ t("border_radius_desc") }}</div>
                        <span class="text-sm font-mono text-primary">{{ borderRadius.toFixed(2) }}rem</span>
                    </div>
                    <div class="flex items-center gap-4">
                        <SquareIcon class="w-4 h-4 text-muted-foreground" />
                        <Slider class="flex-1" :min="0" :max="1.5" :step="0.05" v-model="borderRadiusArray" />
                        <CircleIcon class="w-4 h-4 text-primary" />
                    </div>

                    <!-- Preview -->
                    <div class="mt-4 p-4 border rounded-lg bg-background/50 flex items-center gap-3">
                        <div class="preview-box" :style="{ borderRadius: `${borderRadius}rem` }"></div>
                        <span class="text-xs text-muted-foreground">{{ t("preview") }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Accent Color -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <SparklesIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("accent_color") }}</h3>
            </div>

            <div class="grid grid-cols-8 gap-2">
                <button v-for="color in accentColors" :key="color.id" class="accent-color-btn"
                    :class="{ 'accent-selected': accentColor === color.id }" :style="{ backgroundColor: color.value }"
                    @click="accentColor = color.id" :title="color.name">
                    <CheckIcon v-if="accentColor === color.id" class="w-4 h-4 text-white" />
                </button>
            </div>
        </div>

        <!-- Animations -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <ZapIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("animations_effects") }}</h3>
            </div>

            <div class="space-y-3">
                <div class="setting-item">
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t("enable_animations") }}</div>
                        <div class="text-xs text-muted-foreground">{{ t("enable_animations_desc") }}</div>
                    </div>
                    <Switch v-model:checked="enableAnimations" />
                </div>

                <div class="setting-item">
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t("reduce_motion") }}</div>
                        <div class="text-xs text-muted-foreground">{{ t("reduce_motion_desc") }}</div>
                    </div>
                    <Switch v-model:checked="reduceMotion" />
                </div>

                <div class="setting-item">
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t("enable_blur") }}</div>
                        <div class="text-xs text-muted-foreground">{{ t("enable_blur_desc") }}</div>
                    </div>
                    <Switch v-model:checked="enableBlur" />
                </div>
            </div>
        </div>

        <!-- Accessibility -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <EyeIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("accessibility") }}</h3>
            </div>

            <div class="space-y-3">
                <div class="setting-item">
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t("timestamp_format") }}</div>
                        <div class="text-xs text-muted-foreground">{{ t("timestamp_format_desc") }}</div>
                    </div>
                    <Select v-model="timestampFormat">
                        <SelectTrigger class="w-[150px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="12h">{{ t("timestamp_12h") }}</SelectItem>
                                <SelectItem value="24h">{{ t("timestamp_24h") }}</SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>

                <div class="setting-item">
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t("high_contrast") }}</div>
                        <div class="text-xs text-muted-foreground">{{ t("high_contrast_desc") }}</div>
                    </div>
                    <Switch v-model:checked="highContrast" />
                </div>

                <div class="setting-item">
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t("dyslexia_font") }}</div>
                        <div class="text-xs text-muted-foreground">{{ t("dyslexia_font_desc") }}</div>
                    </div>
                    <Switch v-model:checked="dyslexiaFont" />
                </div>

                <div class="flex flex-col gap-3">
                    <div>
                        <div class="text-sm font-medium">{{ t("color_blind_mode") }}</div>
                        <div class="text-xs text-muted-foreground">{{ t("color_blind_mode_desc") }}</div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div v-for="cbMode in colorBlindModes" :key="cbMode.id" class="colorblind-card"
                            :class="{ 'colorblind-selected': colorBlindMode === cbMode.id }"
                            @click="colorBlindMode = cbMode.id">
                            <div class="colorblind-palette">
                                <div 
                                    v-for="(color, idx) in cbMode.colors" 
                                    :key="idx"
                                    class="colorblind-palette-dot"
                                    :style="{ backgroundColor: color }"
                                />
                            </div>
                            <div class="text-center mt-2">
                                <div class="text-sm font-medium">{{ cbMode.name }}</div>
                                <div class="text-xs text-muted-foreground">{{ cbMode.description }}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Reset Button -->
        <div class="flex justify-end">
            <Button @click="resetToDefaults" variant="outline">
                <RotateCcwIcon class="w-4 h-4 mr-2" />
                {{ t("reset_to_defaults") }}
            </Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useLocale } from "@/store/localeStore";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import Switch from "@/components/ui/switch/Switch.vue";
import {
    PaletteIcon,
    TypeIcon,
    LayoutGridIcon,
    CircleDotIcon,
    SparklesIcon,
    ZapIcon,
    MinusIcon,
    PlusIcon,
    SquareIcon,
    CircleIcon,
    CheckIcon,
    RotateCcwIcon,
    MaximizeIcon,
    MinimizeIcon,
    ShrinkIcon,
    EyeIcon
} from "lucide-vue-next";
import { persistedValue } from "@/lib/persistedValue";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/composables/useTheme";

const { t } = useLocale();
const toast = useToast();
const { applyTheme: applyThemeController, applyAppearanceSettings: applyAppearanceSettingsController } = useTheme();

// Theme definitions
const themes = [
    {
        id: "dark",
        name: t("theme_dark"),
        description: t("theme_dark_desc"),
        preview: {
            background: "linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%)"
        }
    },
    {
        id: "light",
        name: t("theme_light"),
        description: t("theme_light_desc"),
        preview: {
            background: "linear-gradient(135deg, #f5f5f5 0%, #ffffff 100%)"
        }
    },
    {
        id: "oled",
        name: t("theme_oled"),
        description: t("theme_oled_desc"),
        preview: {
            background: "#000000"
        }
    }
];

// Font options
const fonts = [
    { name: "Inter", value: "Inter, sans-serif" },
    { name: "Roboto", value: "Roboto, sans-serif" },
    { name: "Open Sans", value: "'Open Sans', sans-serif" },
    { name: "Lato", value: "Lato, sans-serif" },
    { name: "Fira Sans", value: "'Fira Sans', sans-serif" }
];

// Density options
const densities = [
    { id: "compact", name: t("density_compact"), description: t("density_compact_desc"), icon: MinimizeIcon },
    { id: "comfortable", name: t("density_comfortable"), description: t("density_comfortable_desc"), icon: ShrinkIcon },
    { id: "spacious", name: t("density_spacious"), description: t("density_spacious_desc"), icon: MaximizeIcon }
];

// Color blind modes with color palette visualization
const colorBlindModes = [
    { 
        id: "none", 
        name: t("color_blind_none"), 
        description: "Standard colors",
        colors: ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#a855f7", "#ec4899"]
    },
    { 
        id: "protanopia", 
        name: t("color_blind_protanopia"), 
        description: "Red-weak",
        colors: ["#8b7355", "#22c55e", "#3b82f6", "#d4a574", "#a855f7", "#9370db"]
    },
    { 
        id: "deuteranopia", 
        name: t("color_blind_deuteranopia"), 
        description: "Green-weak",
        colors: ["#ef4444", "#b8860b", "#3b82f6", "#eab308", "#a855f7", "#ec4899"]
    },
    { 
        id: "tritanopia", 
        name: t("color_blind_tritanopia"), 
        description: "Blue-weak",
        colors: ["#ef4444", "#20b2aa", "#008b8b", "#eab308", "#dc143c", "#ec4899"]
    }
];

// Accent colors
const accentColors = [
    { id: "blue", name: t("color_blue"), value: "#3b82f6" },
    { id: "purple", name: t("color_purple"), value: "#a855f7" },
    { id: "pink", name: t("color_pink"), value: "#ec4899" },
    { id: "red", name: t("color_red"), value: "#ef4444" },
    { id: "orange", name: t("color_orange"), value: "#f97316" },
    { id: "yellow", name: t("color_yellow"), value: "#eab308" },
    { id: "green", name: t("color_green"), value: "#22c55e" },
    { id: "teal", name: t("color_teal"), value: "#14b8a6" },
    { id: "cyan", name: t("color_cyan"), value: "#06b6d4" },
    { id: "indigo", name: t("color_indigo"), value: "#6366f1" },
    { id: "violet", name: t("color_violet"), value: "#8b5cf6" },
    { id: "rose", name: t("color_rose"), value: "#f43f5e" }
];

// Persisted settings
const currentTheme = persistedValue<string>("appearance.theme", "dark");
const fontFamily = persistedValue<string>("appearance.fontFamily", "Inter, sans-serif");
const fontSize = persistedValue<number>("appearance.fontSize", 14);
const lineHeight = persistedValue<number>("appearance.lineHeight", 1.5);
const uiDensity = persistedValue<string>("appearance.uiDensity", "comfortable");
// TODO: Enable when webview2 zoom control is implemented
// const uiScale = persistedValue<number>("appearance.uiScale", 100);
const borderRadius = persistedValue<number>("appearance.borderRadius", 0.75);
const accentColor = persistedValue<string>("appearance.accentColor", "blue");
const enableAnimations = persistedValue<boolean>("appearance.enableAnimations", true);
const reduceMotion = persistedValue<boolean>("appearance.reduceMotion", false);
const enableBlur = persistedValue<boolean>("appearance.enableBlur", true);

// Accessibility settings
const timestampFormat = persistedValue<string>("appearance.timestampFormat", "24h");
const highContrast = persistedValue<boolean>("appearance.highContrast", false);
const dyslexiaFont = persistedValue<boolean>("appearance.dyslexiaFont", false);
const colorBlindMode = persistedValue<string>("appearance.colorBlindMode", "none");

// Slider arrays
const fontSizeArray = ref([fontSize.value]);
const lineHeightArray = ref([lineHeight.value]);
// TODO: Enable when webview2 zoom control is implemented
// const uiScaleArray = ref([uiScale.value]);
const borderRadiusArray = ref([borderRadius.value]);

// Watch slider changes
watch(fontSizeArray, (val) => fontSize.value = val[0]);
watch(lineHeightArray, (val) => lineHeight.value = val[0]);
// TODO: Enable when webview2 zoom control is implemented
// watch(uiScaleArray, (val) => uiScale.value = val[0]);
watch(borderRadiusArray, (val) => borderRadius.value = val[0]);

// Apply theme function
const selectTheme = (themeId: string) => {
    currentTheme.value = themeId;
    applyTheme();
};

const applyTheme = () => {
    applyThemeController(currentTheme.value as any);
};

// Watch all settings
// TODO: Add uiScale back when webview2 zoom control is implemented
watch([currentTheme, fontFamily, fontSize, lineHeight, uiDensity, borderRadius, accentColor, enableAnimations, reduceMotion, enableBlur, timestampFormat, highContrast, dyslexiaFont, colorBlindMode], () => {
    applyAppearanceSettingsController();
});

// Reset to defaults
const resetToDefaults = () => {
    currentTheme.value = "dark";
    fontFamily.value = "Inter, sans-serif";
    fontSize.value = 14;
    lineHeight.value = 1.5;
    uiDensity.value = "comfortable";
    // TODO: Enable when webview2 zoom control is implemented
    // uiScale.value = 100;
    borderRadius.value = 0.75;
    accentColor.value = "blue";
    enableAnimations.value = true;
    reduceMotion.value = false;
    enableBlur.value = true;

    // Reset accessibility settings
    timestampFormat.value = "24h";
    highContrast.value = false;
    dyslexiaFont.value = false;
    colorBlindMode.value = "none";

    fontSizeArray.value = [14];
    lineHeightArray.value = [1.5];
    // TODO: Enable when webview2 zoom control is implemented
    // uiScaleArray.value = [100];
    borderRadiusArray.value = [0.75];

    toast.toast({
        title: t("settings_reset"),
        description: t("appearance_reset_desc"),
    });
};

// Initialize on mount
onMounted(() => {
    applyAppearanceSettingsController();
});
</script>

<style scoped>
.setting-card {
    @apply rounded-xl border bg-card p-6 shadow-sm transition-all hover:shadow-md;
}

.setting-item {
    @apply flex items-center justify-between gap-4 p-3 rounded-lg bg-background/30 border transition-colors hover:bg-background/50;
}

/* Theme cards */
.theme-card {
    @apply p-3 rounded-lg border-2 border-border cursor-pointer transition-all hover:scale-105 hover:shadow-lg;
}

.theme-selected {
    @apply border-primary shadow-lg;
}

.theme-preview {
    @apply w-full h-24 rounded-lg overflow-hidden relative;
}

.theme-preview-top {
    @apply absolute top-0 left-0 right-0 h-6 bg-black/20;
}

.theme-preview-sidebar {
    @apply absolute left-0 top-6 bottom-0 w-8 bg-black/30;
}

.theme-preview-content {
    @apply absolute left-8 top-6 right-0 bottom-0 bg-black/10;
}

/* Density cards */
.density-card {
    @apply p-4 rounded-lg border-2 border-border cursor-pointer transition-all hover:scale-105 text-center;
}

.density-selected {
    @apply border-primary bg-primary/10;
}

/* Accent color buttons */
.accent-color-btn {
    @apply w-10 h-10 rounded-lg border-2 border-transparent cursor-pointer transition-all hover:scale-110 flex items-center justify-center;
}

.accent-selected {
    @apply border-white ring-2 ring-offset-2 ring-primary scale-110;
}

/* Preview box */
.preview-box {
    @apply w-16 h-16 bg-gradient-to-br from-primary/50 to-primary border-2 border-primary/50;
}

/* Color blind mode cards */
.colorblind-card {
    @apply p-3 rounded-lg border-2 border-border cursor-pointer transition-all hover:scale-105 hover:shadow-lg;
}

.colorblind-selected {
    @apply border-primary shadow-lg bg-primary/5;
}

.colorblind-palette {
    @apply w-full h-16 rounded-lg overflow-hidden bg-muted p-1.5 grid grid-cols-3 grid-rows-2 gap-1;
}

.colorblind-palette-dot {
    @apply rounded-full w-full h-full shadow-sm;
}
</style>
