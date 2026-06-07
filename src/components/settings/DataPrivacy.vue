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

        <!-- Screencast drawing: who may draw on my shared screen. -->
        <div v-if="ff.screencastDrawingActive">
            <div class="flex flex-row items-center justify-between rounded-lg border p-4">
                <div class="space-y-0.5">
                    <div class="text-base">Drawing on my streams</div>
                    <div class="text-sm text-muted-foreground">
                        Who can draw over a screen you're sharing
                    </div>
                </div>
                <select
                    v-model.number="streamDrawMode"
                    class="bg-transparent border rounded-md px-3 py-1.5 text-sm"
                    :disabled="loading"
                    @change="save">
                    <option :value="0">Everybody</option>
                    <option :value="1">Contacts</option>
                    <option :value="2">Nobody</option>
                </select>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Switch } from "@argon/ui/switch";
import { useLocale } from "@/store/system/localeStore";
import { useApi } from "@/store/system/apiStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import { logger } from "@argon/core";

const { t } = useLocale();
const api = useApi();
const ff = useFeatureFlags();

const STREAM_DRAW_KEY = "stream.draw";
// 0 = Everybody, 1 = Contacts, 2 = Nobody (matches ion PrivacyRuleMode).
const streamDrawMode = ref<number>(0);
const loading = ref(false);

onMounted(async () => {
    if (!ff.screencastDrawingActive) return;
    loading.value = true;
    try {
        const rule = await api.privacyInteraction.GetPrivacyRule(STREAM_DRAW_KEY, null);
        if (rule) streamDrawMode.value = rule.mode as unknown as number;
    } catch (e) {
        logger.warn("[privacy] failed to load stream.draw rule", e);
    } finally {
        loading.value = false;
    }
});

async function save(): Promise<void> {
    loading.value = true;
    try {
        await api.privacyInteraction.SetPrivacyRule(
            STREAM_DRAW_KEY,
            streamDrawMode.value as any,
            null,
            [],
            [],
        );
    } catch (e) {
        logger.warn("[privacy] failed to save stream.draw rule", e);
    } finally {
        loading.value = false;
    }
}
</script>
