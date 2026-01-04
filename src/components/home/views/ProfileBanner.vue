<template>
    <div class="relative w-full h-48 rounded-2xl overflow-hidden">
        <video playsinline autoplay muted loop alt="cover" class="w-full h-full object-cover" v-if="!bannerId">
            <source :src="`https://xcdn.argon.gl/user/${userId.replaceAll('-', '')}/${bannerId}`" type="video/mp4">
        </video>

        <video playsinline autoplay muted loop alt="cover" class="w-full h-full object-cover banner-bg" v-else>
        </video>
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
    background-color: hsl(var(--card));
}
</style>