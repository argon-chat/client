<template>
    <div class="space-y-6 language-settings">
        <h2 class="text-2xl font-bold mb-6">{{ t("app_language") }}</h2>

        <!-- Language Selection Card -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <LanguagesIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">Select Language</h3>
            </div>

            <RadioGroup v-model="locale" class="space-y-3">
                <div 
                    v-for="language in languages" 
                    :key="language.code"
                    class="language-item"
                    :class="{
                        'language-selected': isSelected(language),
                        'language-disabled': isDisabled(language)
                    }"
                    @click="canSelect(language) && selectLanguage(language.code)"
                >
                    <div class="flex items-center gap-3 flex-1">
                        <span class="language-emoji" v-html="language.emoji"></span>
                        <div class="flex-1">
                            <div 
                                class="text-sm font-medium" 
                                :style="language.fontFamily ? { 'font-family': language.fontFamily } : undefined"
                            >
                                {{ language.key }}
                            </div>
                        </div>
                    </div>
                    <RadioGroupItem 
                        :value="language.code" 
                        :disabled="isDisabled(language)" 
                    />
                </div>
            </RadioGroup>
        </div>
    </div>
</template>

<script setup lang="ts">
import { RadioGroup, RadioGroupItem } from "@argon/ui/radio-group";
import { useLocale } from "@/store/localeStore";
import { availableLanguages } from "@/lib/languages";
import { useLanguageSelection } from "@/composables/useLanguageSelection";
import { LanguagesIcon } from "lucide-vue-next";
import { ref, watch } from "vue";

const { t, currentLocale, updateLocale } = useLocale();

const locale = ref(currentLocale);
const languages = availableLanguages;

const { justSelected, selectLanguage, isSelected, isDisabled, canSelect } = 
  useLanguageSelection(locale, {
    onSelect: (code) => updateLocale(code),
  });

watch(locale, (newLocale) => {
  updateLocale(newLocale);
});
</script>

<style scoped>
.language-settings {
    @apply max-w-5xl mx-auto;
}

.setting-card {
    @apply rounded-xl border bg-card p-6 shadow-sm transition-all hover:shadow-md;
}

.language-item {
    @apply flex items-center justify-between gap-4 p-3 rounded-lg bg-background/30 border transition-all cursor-pointer;
}

.language-item:hover {
    @apply bg-background/50 border-primary/30;
}

.language-selected {
    @apply bg-primary/10 border-primary/50;
}

.language-disabled {
    @apply opacity-50 cursor-not-allowed pointer-events-none;
}

.language-emoji {
    @apply text-2xl transition-transform duration-200;
}

.language-item:hover .language-emoji {
    @apply scale-110;
}
</style>
