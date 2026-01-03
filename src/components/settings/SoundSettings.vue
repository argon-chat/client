<template>
    <div class="space-y-6">
        <h2 class="text-2xl font-bold mb-6">{{ t("sounds") }}</h2>

        <!-- Volume Control Card -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <Volume2Icon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("sound_level") }}</h3>
            </div>
            
            <div class="volume-control-wrapper">
                <div class="volume-slider-container">
                    <VolumeXIcon class="w-4 h-4 text-muted-foreground" />
                    <Slider 
                        class="flex-1" 
                        :step="0.05" 
                        :max="1" 
                        v-model="soundLevel" 
                    />
                    <Volume2Icon class="w-5 h-5 text-primary" />
                </div>
                
                <div class="flex items-center gap-3 mt-4">
                    <div class="volume-display">
                        {{ Math.round(preferenceStore.soundLevel * 100) }}%
                    </div>
                    <Button 
                        @click="playTestSound" 
                        variant="outline" 
                        size="sm"
                        :disabled="isPlayingSound"
                        class="flex-1"
                    >
                        <PlayIcon v-if="!isPlayingSound" class="w-4 h-4 mr-2" />
                        <Loader2Icon v-else class="w-4 h-4 mr-2 animate-spin" />
                        Test Sound
                    </Button>
                </div>
            </div>
            
            <p class="text-xs text-muted-foreground mt-3">
                {{ t("sound_power_of_system_notification") }}
            </p>
        </div>

        <!-- Sound Notifications Card -->
        <div class="setting-card">
            <div class="flex items-center gap-2 mb-4">
                <BellIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">Sound Notifications</h3>
            </div>
            
            <div class="space-y-3">
                <div 
                    v-for="i in soundControllers" 
                    :key="i.name"
                    class="setting-item"
                >
                    <div class="flex-1">
                        <div class="text-sm font-medium">{{ t(i.name) }}</div>
                        <div class="text-xs text-muted-foreground">
                            {{ t(i.name + '_details') }}
                        </div>
                    </div>
                    <Switch 
                        :checked="i.r.value" 
                        @update:checked="(x: boolean) => i.r.value = x"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { usePreference } from "@/store/preferenceStore";
import { useLocale } from "@/store/localeStore";
import { ref } from "vue";
import { Slider } from "@/components/ui/slider";
import { watchArray } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { 
  Volume2Icon, 
  VolumeXIcon, 
  BellIcon, 
  PlayIcon, 
  Loader2Icon 
} from "lucide-vue-next";
import Switch from "@/components/ui/switch/Switch.vue";
import Button from "@/components/ui/button/Button.vue";
import { useTone } from "@/store/toneStore";

const { t } = useLocale();
const tone = useTone();
const preferenceStore = usePreference();

const isPlayingSound = ref(false);

const playTestSound = async () => {
  isPlayingSound.value = true;
  if (Math.random() > 0.5) tone.playSoftEnterSound();
  else tone.playSoftLeaveSound();
  
  setTimeout(() => {
    isPlayingSound.value = false;
  }, 500);
};

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
  { r: isEnable_playSoftEnterSound, name: "playSoftEnterSound" },
  { r: isEnable_playReconnectSound, name: "playReconnectSound" },
  { r: isEnable_playSoftLeaveSound, name: "playSoftLeaveSound" },
  { r: isEnable_playMuteAllSound, name: "playMuteAllSound" },
  { r: isEnable_playUnmuteAllSound, name: "playUnmuteAllSound" },
  { r: isEnable_playNotificationSound, name: "playNotificationSound" },
  { r: isEnable_playRingSound, name: "playRingSound" },
];

const soundLevel = ref([preferenceStore.soundLevel]);

watchArray(soundLevel, (newList) => {
  preferenceStore.soundLevel = newList[0];
});
</script>

<style scoped>
.setting-card {
    @apply rounded-xl border bg-card p-6 shadow-sm transition-all hover:shadow-md;
}

.setting-item {
    @apply flex items-center justify-between gap-4 p-3 rounded-lg bg-background/30 border transition-colors hover:bg-background/50;
}

.volume-control-wrapper {
    @apply space-y-4;
}

.volume-slider-container {
    @apply flex items-center gap-4;
}

.volume-display {
    @apply px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-center font-mono text-lg font-bold text-primary min-w-[80px];
}

.focus\:ring-ring:focus {
    --tw-ring-color: hsl(0deg 0% 0% / 0%);
}
</style>
