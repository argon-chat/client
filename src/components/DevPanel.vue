<script setup lang="ts">
import { useMagicKeys } from "@vueuse/core";
import { ref, watch } from "vue";
import { AutoForm } from "./ui/auto-form";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";
import { useConfig } from "@/store/remoteConfig";
import { useLocale } from "@/store/localeStore";

const keys = useMagicKeys();
const cfg = useConfig();
const { t } = useLocale();
watch(keys["Ctrl+Shift+F9"], (v) => {
  if (v) {
    devPanelShow.value = !devPanelShow.value;
  }
});

const devPanelShow = ref(false);

function applyChanges(data: any) {
  logger.success("Changes Applied!", data);
  for (const key in data) {
    if (data[key]) cfg.setOverride(key, data[key]);
  }
}
</script>

<template>
    <Transition enter-active-class="transition-transform duration-300 ease-out"
        leave-active-class="transition-transform duration-300 ease-in" enter-from-class="-translate-x-full"
        enter-to-class="translate-x-0" leave-from-class="translate-x-0" leave-to-class="-translate-x-full">
        <div v-if="devPanelShow"
            class="fixed top-0 left-0 h-full w-80 bg-black bg-opacity-70 backdrop-blur-md z-50 p-6 overflow-y-auto">
            <h2 class="text-xl font-bold mb-4 text-white">{{ t("development_panel") }}</h2>
            
        </div>
    </Transition>
</template>
