<template>
    <Dialog v-model:open="open">
        <DialogContent
            class="sm:max-w-[420px] rounded-2xl border bg-card/95 backdrop-blur-2xl p-8 space-y-6">

            <div class="relative text-center space-y-3">
                <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                    <span class="i-lucide-mic-off text-destructive text-2xl"></span>
                </div>
                <h2 class="text-xl font-bold text-foreground">
                    {{ errorTitle }}
                </h2>
                <p class="text-muted-foreground text-sm leading-relaxed">
                    {{ errorDescription }}
                </p>
            </div>

            <div class="flex flex-col gap-2">
                <Button @click="goToSettings" class="w-full font-semibold rounded-xl">
                    <span class="i-lucide-settings mr-2"></span>
                    {{ t('go_to_settings') }}
                </Button>
                <Button variant="ghost" @click="open = false" class="w-full rounded-xl">
                    {{ t('close') }}
                </Button>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Dialog, DialogContent } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { useLocale } from "@/store/system/localeStore";
import { useWindow } from "@/store/ui/windowStore";

const { t } = useLocale();
const windows = useWindow();

const open = defineModel<boolean>('open', { type: Boolean, default: false });

const props = defineProps<{
    errorType: 'not-found' | 'not-readable' | null;
}>();

const errorTitle = computed(() => {
    if (props.errorType === 'not-found') return t('audio_device_not_found_title');
    if (props.errorType === 'not-readable') return t('audio_device_not_readable_title');
    return t('microphone');
});

const errorDescription = computed(() => {
    if (props.errorType === 'not-found') return t('audio_device_not_found_desc');
    if (props.errorType === 'not-readable') return t('audio_device_not_readable_desc');
    return '';
});

function goToSettings() {
    open.value = false;
    windows.settingsOpen = true;
}
</script>
