<template>
    <Dialog v-model:open="open">
        <DialogContent described
            class="sm:max-w-[420px] rounded-2xl border bg-card/95 backdrop-blur-2xl p-8 space-y-6">

            <div class="relative text-center space-y-3">
                <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                    <span class="i-lucide-phone-off text-destructive text-2xl"></span>
                </div>
                <DialogTitle as="h2" class="text-xl font-bold text-foreground leading-7">
                    {{ t('call_connect_failed_title') }}
                </DialogTitle>
                <DialogDescription class="text-muted-foreground text-sm leading-relaxed">
                    {{ t('call_connect_failed_desc') }}
                </DialogDescription>
                <p v-if="message" class="text-muted-foreground/70 text-xs font-mono break-words rounded-lg bg-muted/50 px-3 py-2">
                    {{ message }}
                </p>
            </div>

            <div class="flex flex-col gap-2">
                <Button @click="open = false" class="w-full font-semibold rounded-xl">
                    {{ t('close') }}
                </Button>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { useLocale } from "@/store/system/localeStore";

const { t } = useLocale();

const open = defineModel<boolean>('open', { type: Boolean, default: false });

defineProps<{
    message: string | null;
}>();
</script>
