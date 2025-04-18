<template>
    <div class="profile-settings text-white rounded-lg space-y-6">
        <h2 class="text-2xl font-bold">{{ t("sounds") }}</h2>
        <div>
            <br />
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        Sound Level
                    </div>
                    <div class="text-sm text-muted-foreground">
                        Sound power of system notifications
                    </div>
                </div>
                <Slider style="padding: 10px;" :step="0.05" :max="1" v-model="soundLevel" />
                <div style="padding: 10px;"> {{ Math.round(preferenceStore.soundLevel * 100) }}% </div>
            </div>


            <div class="flex flex-row items-center justify-between rounded-lg border p-4" style="margin-top: 15px;" v-for="i in soundControllers">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{ t(i.name) }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{ t(i.name + '_details') }}
                    </div>
                </div>
                <Switch :checked="i.r.value"
                    @update:checked="(x: boolean) => i.r.value = x" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { usePreference } from '@/store/preferenceStore';
import { useLocale } from '@/store/localeStore';
import { ref } from 'vue';
import { Slider } from '@/components/ui/slider'
import { watchArray } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import Switch from '../ui/switch/Switch.vue';

const { t } = useLocale();
const preferenceStore = usePreference();

const {
    isEnable_playSoftEnterSound,
    isEnable_playReconnectSound,
    isEnable_playSoftLeaveSound,
    isEnable_playMuteAllSound,
    isEnable_playUnmuteAllSound,
    isEnable_playNotificationSound,
    isEnable_playRingSound,
} = storeToRefs(preferenceStore);

const soundControllers = [
    {r: isEnable_playSoftEnterSound, name: "playSoftEnterSound"},
    {r: isEnable_playReconnectSound, name: "playReconnectSound"},
    {r: isEnable_playSoftLeaveSound, name: "playSoftLeaveSound"},
    {r: isEnable_playMuteAllSound, name: "playMuteAllSound"},
    {r: isEnable_playUnmuteAllSound, name: "playUnmuteAllSound"},
    {r: isEnable_playNotificationSound, name: "playNotificationSound"},
    {r: isEnable_playRingSound, name: "playRingSound"},
]

const soundLevel = ref([preferenceStore.soundLevel]);

watchArray(soundLevel, (newList) => {
    preferenceStore.soundLevel = newList[0];
});
</script>
<style scoped>
.profile-settings {
    max-width: 900px;
    margin: 0 auto;
}
</style>
