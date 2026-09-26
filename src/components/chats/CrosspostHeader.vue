<template>
  <span v-if="header" class="inline-flex items-center gap-1.5 min-w-0" data-testid="crosspost-header">
    <span class="text-[13px] font-semibold leading-none text-foreground truncate" :title="header.label">
      {{ header.label }}
    </span>

    <TooltipProvider :delay-duration="300">
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="crosspost-tag">{{ t("crosspost_tag") }}</span>
        </TooltipTrigger>
        <TooltipContent side="top">{{ t("crosspost_tag_hint") }}</TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <span
      v-if="authorName"
      class="text-[11px] leading-none text-muted-foreground/70 truncate"
      data-testid="crosspost-author"
    >
      {{ t("crosspost_by", { name: authorName }) }}
    </span>
  </span>
</template>

<script setup lang="ts">
/**
 * The meta row of a crosspost: where it was published, a "Following" chip, and the author in small
 * print — only when they are known here, since they are usually not a member of this space, and
 * never when the source posts as the space without naming its authors (`hideAuthor`).
 */
import { computed } from "vue";
import type { ArgonMessage } from "@argon/glue";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@argon/ui/tooltip";
import { useLocale } from "@/store/system/localeStore";
import { crosspostHeaderOf } from "@/composables/useChannelFollow";

const props = defineProps<{
  message: Pick<ArgonMessage, "crosspost">;
  author?: { displayName?: string | null } | null;
}>();

const { t } = useLocale();

const header = computed(() => crosspostHeaderOf(props.message));
const authorName = computed(() => (props.message.crosspost?.hideAuthor ? null : props.author?.displayName || null));
</script>

<style scoped>
/* The BOT chip's shape, in a quieter tint. */
.crosspost-tag {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  height: 14px;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted-foreground) / 0.14);
  border: 1px solid hsl(var(--muted-foreground) / 0.22);
  cursor: default;
  user-select: none;
}
</style>
