<template>
    <div class="connected-devices text-white rounded-lg space-y-6">
        <h2 class="text-2xl font-bold">{{ t("app_language") }}</h2>

        <RadioGroup v-model="loc">
            <div class="flex flex-row items-center justify-between rounded-lg border p-4" v-for="i in allLang" :key="i.code">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{ i.key }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        <i v-html="i.emoji"/>
                    </div>
                </div>
                <RadioGroupItem :value="i.code" class="item" />
            </div>
        </RadioGroup>
    </div>
</template>

<script setup lang="ts">
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useLocale } from '@/store/localeStore';
import { ref, watch } from 'vue';

const { t, currentLocale, updateLocale } = useLocale();

const loc = ref(currentLocale);

watch(loc, (e) => {
    updateLocale(e);
});

const allLang = [
    { key: "English, UK", code: "en", emoji: '<i class="em em-flag-um" aria-role="presentation" aria-label="U.S. Outlying Islands Flag"></i>' },
    { key: "Пирацкий", code: "ru_pt", emoji: '<i class="em em-pirate_flag" aria-role="presentation" aria-label=""></i>' },
    { key: "日本語", code: "jp", emoji: '<i class="em em-jp" aria-role="presentation" aria-label="Japan Flag"></i>' },
    { key: "Русский", code: "ru", emoji: '<i class="em em-ru" aria-role="presentation" aria-label="Russia Flag"></i>' },
]
</script>

<style lang="css" scoped>
.selectItem {
    flex-direction: row;
    margin-bottom: 8px;
    color: var(--interactive-normal);
    cursor: pointer;
    border-radius: 3px;
    display: block;
    box-sizing: border-box;
    border-left: 3px solid #fff;
    border-radius: 4px;
    display: grid;
    grid-gap: 8px;
    align-items: center;
}
</style>
