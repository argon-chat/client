<template>
    <div class="relative w-full h-48 rounded-2xl overflow-hidden">
        <!-- The branches were swapped: a profile without a banner requested ".../null" and a profile
             with one rendered an empty player. The fallback is a plain box, not a media element. -->
        <video playsinline autoplay muted loop alt="cover" class="w-full h-full object-cover" v-if="bannerId">
            <source :src="`https://xcdn.argon.gl/user/${userId.replaceAll('-', '')}/${bannerId}`" type="video/mp4">
        </video>

        <div class="w-full h-full banner-bg" v-else></div>
    </div>
</template>
<script lang="ts" setup>
import { Guid } from '@argon-chat/ion.webcore';


const props = defineProps<{
    bannerId: string | null,
    userId: Guid
}>()
</script>
<style scoped>
.banner-bg {
    background-color: hsl(var(--card) / var(--card-alpha));
}
</style>