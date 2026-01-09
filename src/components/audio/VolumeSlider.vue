<template>
    <!-- @vue-ignore -->
    <Slider :max="200" :step="1" v-model="user.volume" :range-class="volumeRangeClass" :thumb-class="volumeThumbClass"
        :disabled="sys.headphoneMuted"
        @update:model-value="onVolumeChange" @dblclick="resetVolume" />
</template>

<script setup lang="ts">
import { IRealtimeChannelUserWithData } from "@/store/poolStore";
import { computed } from "vue";
import { useUnifiedCall } from "@/store/unifiedCallStore";
import { useSystemStore } from "@/store/systemStore";
import Slider from "@/components/ui/slider/Slider.vue";

const props = defineProps<{ user: IRealtimeChannelUserWithData }>();
const voice = useUnifiedCall();
const sys = useSystemStore();
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
    voice.setVolume(props.user.userId, val[0]);
}

function resetVolume() {
    voice.setVolume(props.user.userId, 100);
}
</script>