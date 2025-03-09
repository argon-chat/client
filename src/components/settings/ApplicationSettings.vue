<template>
    <div class="profile-settings p-6  text-white rounded-lg space-y-6" v-if="me.me">
        <h2 class="text-2xl font-bold">{{ t("application_settings") }}</h2>
        <div>
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">
                        {{ t("close_behaviour") }}
                    </div>
                    <div class="text-sm text-muted-foreground">
                        {{ t("minimize_to_tray") }}
                    </div>
                </div>
                <Switch :checked="preferenceStore.minimizeToTrayOnClose"
                    @update:checked="(x) => preferenceStore.minimizeToTrayOnClose = x" />
            </div>
            <br/>
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <label class="block font-semibold mb-1">Dev Tools</label>
                <button @click="toggleDevTools" class="button bg-red-500 text-white rounded px-4 py-2 hover:bg-red-600">
                    Open Dev Tools
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useMe } from '@/store/meStore';
import { usePreference } from '@/store/preferenceStore';
import Switch from '../ui/switch/Switch.vue';
import { useLocale } from '@/store/localeStore';
const { t } = useLocale();

const me = useMe();
const preferenceStore = usePreference();


const toggleDevTools = () => {
    native.toggleDevTools();
}

</script>
<style scoped>
.profile-settings {
    max-width: 600px;
    margin: 0 auto;
}
</style>
