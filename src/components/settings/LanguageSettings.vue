<template>
    <div class="connected-devices text-white rounded-lg space-y-6">
        <h2 class="text-2xl font-bold">{{ t("app_language") }}</h2>

        <RadioGroup v-model="loc">
            <div class="flex flex-row items-center justify-between rounded-lg border p-4" v-for="i in allLang" :key="i.code">
                <div class="space-y-0.5">
                    <div class="text-base" :style="{ 'font-family': i.fontFamily }">
                        {{ i.key }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        <i v-html="i.emoji"/>
                    </div>
                </div>
                <RadioGroupItem :value="i.code" class="item" :disabled="'disabled' in i" />
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
    { key: "Հայկական", code: "am", emoji: '<i class="em em-flag-am" aria-role="presentation" aria-label="Armenia Flag"></i>' },
    { key: "tengwar annatar", code: "en", emoji: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="25" height="23" viewBox="0,0,480,320"><g transform="translate(0,-20)"><g stroke="#000000" stroke-width="0" stroke-miterlimit="10"><path d="M0,340v-320h480v320z" fill="#000000"/><path d="M12,328v-296h456v296zM462,322v-284h-444v284zM191.14538,188.01766v44.93393l0.1762,7.57707l1.85021,4.3172l5.90309,0.70484l6.34362,-2.81941l2.20264,2.46697l-16.47576,7.92951l-14.80177,6.87223h-4.31717v-123.78853c0,-9.51542 -0.17621,-15.33039 -0.52863,-17.44493c-0.23496,-2.29075 -1.14539,-3.93538 -2.73128,-4.93393c-1.29222,-0.93979 -2.90749,-1.40969 -4.84582,-1.40969c-1.29222,0 -3.99412,0.52863 -8.10572,1.5859l-1.40969,-3.25991l31.54185,-10.39648h5.19825v12.07049c4.81644,-4.11159 9.63289,-7.13657 14.44933,-9.07489c4.81644,-1.99706 10.24963,-2.9956 16.29955,-2.9956c10.10279,0 19.00148,2.93685 26.69604,8.81057c3.23055,-2.5257 6.84288,-4.5815 10.837,-6.16741c4.7577,-1.99706 10.16153,-2.99559 16.21146,-2.99559c11.62995,0 21.67401,3.96476 30.13216,11.89427c8.51689,7.81204 12.77533,17.5624 12.77533,29.2511c0,5.87373 -1.14538,11.27755 -3.43613,16.21147c-2.40822,4.93392 -5.93246,9.98531 -10.57269,15.15418h21.05727l-13.48018,15.5066zM236.25551,172.86347c4.93392,-5.99117 7.40088,-13.97943 7.40088,-23.96476c0,-12.51101 -3.46549,-22.26138 -10.39647,-29.2511c-6.04993,-6.04993 -13.2746,-9.07489 -21.67401,-9.07489c-7.10719,0 -13.9207,2.79002 -20.44053,8.37005v53.9207zM289.55948,172.86347c5.28634,-6.51983 7.92951,-14.65492 7.92951,-24.40529c0,-12.51101 -3.5536,-22.232 -10.66079,-29.16298c-6.04992,-6.04993 -13.27459,-9.07489 -21.67401,-9.07489c-4.1116,0 -8.07637,0.96916 -11.89427,2.90749c7.81204,7.5771 11.71806,17.03377 11.71806,28.37005c0,11.74742 -4.14096,22.20264 -12.42291,31.36564z" fill="#e1cf03"/></g></g><script xmlns=""/></svg>', fontFamily: 'Tengwar Annatar', disabled: true },
]// 
</script>

<style lang="css">
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
