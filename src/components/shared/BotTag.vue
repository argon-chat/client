<template>
  <TooltipProvider v-if="visible" :delayDuration="300">
    <Tooltip>
      <TooltipTrigger as-child>
        <span class="bot-tag" :class="{ 'bot-tag--system': isSystem }">
          {{ isSystem ? t("system_tag") : t("bot_tag") }}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {{ isSystem ? t("system_account") : t("bot_account") }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<script setup lang="ts">
/**
 * The "BOT" chip next to a display name.
 *
 * Reads `UserFlag` off the user rather than taking a boolean, so every call site agrees on what
 * counts as a bot — the flag is the only thing the server sends about it. SYSTEM outranks BOT
 * because the system account is also flagged BOT and "SYSTEM" is the more useful thing to say.
 */
import { computed } from "vue";
import { UserFlag } from "@argon/glue";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@argon/ui/tooltip";
import { useLocale } from "@/store/system/localeStore";

const { t } = useLocale();

const props = defineProps<{ flags?: UserFlag | number | null }>();

const isSystem = computed(() => ((props.flags ?? 0) & UserFlag.SYSTEM) !== 0);
const visible = computed(() => isSystem.value || ((props.flags ?? 0) & UserFlag.BOT) !== 0);
</script>

<style scoped>
.bot-tag {
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
  /* Tinted rather than solid: --primary is a near-white in the shipped themes, so a filled chip
     would out-shout the display name it sits next to. */
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.16);
  border: 1px solid hsl(var(--primary) / 0.25);
  cursor: default;
  user-select: none;
}

.bot-tag--system {
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted-foreground) / 0.16);
  border-color: hsl(var(--muted-foreground) / 0.25);
}
</style>
