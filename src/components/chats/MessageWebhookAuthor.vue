<template>
  <!-- Avatar column -->
  <div v-if="part === 'avatar'" class="w-9 h-9" data-testid="webhook-avatar">
    <ArgonAvatar
      v-if="webhook.avatarFileId"
      :file-id="webhook.avatarFileId"
      :fallback="webhook.name"
      :overrided-size="36"
      class="w-9 h-9 rounded-full"
    />
    <div
      v-else
      class="w-9 h-9 rounded-full flex items-center justify-center text-white"
      :style="{ backgroundColor: color }"
    >
      <WebhookIcon class="w-4 h-4" />
    </div>
  </div>

  <!-- Name + tag in the meta row -->
  <template v-else>
    <span class="text-[13px] font-semibold leading-none" :style="{ color }" data-testid="webhook-name">
      {{ webhook.name }}
    </span>
    <span class="webhook-tag" :title="t('webhook_tag_hint')" data-testid="webhook-tag">{{ t("webhook_tag") }}</span>
  </template>
</template>

<script setup lang="ts">
/**
 * Who posted a webhook message: the webhook's name (or the name the request gave), its avatar if it
 * has one, and a WEBHOOK chip. Stands in for the author's avatar and name in MessageItem, since the
 * message's sender is the system user.
 */
import { computed } from "vue";
import { WebhookIcon } from "lucide-vue-next";
import type { WebhookAuthor } from "@argon/glue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { useUserColors } from "@/store/chat/userColors";
import { useLocale } from "@/store/system/localeStore";

const props = defineProps<{ webhook: WebhookAuthor; part: "avatar" | "name" }>();

const { t } = useLocale();
const userColors = useUserColors();

const color = computed(() => userColors.getColorByUserId(props.webhook.webhookId));
</script>

<style scoped>
.webhook-tag {
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
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.16);
  border: 1px solid hsl(var(--primary) / 0.25);
  cursor: default;
  user-select: none;
}
</style>
