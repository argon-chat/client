<template>
    <Slider :max="200" :step="1" v-model="user.volume" :range-class="volumeRangeClass" :thumb-class="volumeThumbClass"
        @update:model-value="onVolumeChange" @dblclick="resetVolume" />
</template>

<script setup lang="ts">
import { IRealtimeChannelUserWithData } from "@/store/poolStore";
import { useVoice } from "@/store/voiceStore";
import { computed } from "vue";
import Slider from "./ui/slider/Slider.vue";

const props = defineProps<{ user: IRealtimeChannelUserWithData }>();
const voice = useVoice();
const volumeRangeClass = computed(() => {
    // @ts-ignore
    const vol = props.user.volume[0];
    if (vol > 170) return "bg-red-500";
    if (vol > 100) return "bg-orange-500";
    return "bg-primary";
});

const volumeThumbClass = computed(() => {
    // @ts-ignore
    const vol = props.user.volume[0];
    if (vol > 170) return "border-red-500";
    if (vol > 100) return "border-orange-500";
    return "border-primary";
});

function onVolumeChange(val: number[]) {
    voice.setUserVolume(props.user.userId, val[0]);
}

function resetVolume() {
    voice.setUserVolume(props.user.userId, 100);
}
</script>
