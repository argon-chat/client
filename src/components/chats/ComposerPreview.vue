<template>
  <div class="mb-1.5 max-h-40 overflow-y-auto rounded-lg border border-border/60 bg-muted/30 px-3 py-2" data-testid="composer-preview">
    <div class="mb-1 text-[11px] font-medium text-muted-foreground">{{ t("composer_preview") }}</div>
    <div v-if="fragments.length" class="text-sm leading-[1.45] text-foreground break-words whitespace-pre-wrap" data-testid="composer-preview-body">
      <ChatSegment v-for="(seg, i) in fragments" :key="i" :entity="seg.entity" :text="seg.text" />
    </div>
    <div v-else class="text-xs italic text-muted-foreground">{{ t("composer_preview_empty") }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { fragmentMessageText } from "@/composables/useMessageContent";
import type { ParsedMessage } from "@/lib/chat/parseMessageContent";
import { useLocale } from "@/store/system/localeStore";
import ChatSegment from "./ChatSegment.vue";

/** The message as it will look once sent: the same parse, fragments and segments a message uses. */
const props = defineProps<{ content: ParsedMessage }>();

const { t } = useLocale();

const fragments = computed(() => fragmentMessageText(props.content.text, props.content.entities));
</script>
