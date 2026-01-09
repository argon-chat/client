<template>
    <div class="profile-settings text-white rounded-lg space-y-6">
        <h2 class="text-2xl font-bold">{{ t("privacy_settings") }}</h2>
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
                <Switch :disabled="true" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Switch } from "@argon/ui/switch";
import { useLocale } from "@/store/localeStore";
const { t } = useLocale();
</script>