<template>
  <span
    class="ml-1 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/60 select-none whitespace-nowrap"
    :title="title"
    data-testid="published-mark"
  >
    <MegaphoneIcon class="w-3 h-3" />
    {{ t("message_published") }}
  </span>
</template>

<script setup lang="ts">
/** "Published" after an announcement that went out to the channels following it; the title says when. */
import { computed } from "vue";
import type { IonDateTime } from "@argon-chat/ion.webcore";
import { MegaphoneIcon } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";

const props = defineProps<{ at: IonDateTime }>();
const { t } = useLocale();

const title = computed(() => {
  const at = typeof props.at?.toDate === "function" ? props.at.toDate() : null;
  return at ? `${t("message_published_at")} ${at.toLocaleString()}` : t("message_published_at");
});
</script>
