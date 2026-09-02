<template>
  <Transition
    enter-active-class="transition-all duration-150 ease-out"
    leave-active-class="transition-all duration-100 ease-in"
    enter-from-class="opacity-0 -translate-y-1"
    leave-to-class="opacity-0 -translate-y-1"
  >
    <div v-if="visible" class="flex items-center gap-3 px-3 pt-2 pb-2 overflow-hidden">
      <!-- Accent bar -->
      <div class="w-[3px] self-stretch rounded-full shrink-0 bg-primary" />

      <!-- Thumbnail / state icon -->
      <div class="w-9 h-9 shrink-0 rounded-md overflow-hidden bg-muted flex items-center justify-center text-muted-foreground">
        <img
          v-if="preview?.imageUrl && !imageFailed"
          :src="preview.imageUrl"
          alt=""
          class="w-full h-full object-cover"
          @error="imageFailed = true"
        />
        <Loader2Icon v-else-if="loading" class="w-4 h-4 animate-spin" />
        <LinkIcon v-else class="w-4 h-4" />
      </div>

      <!-- Text -->
      <div class="flex flex-col gap-0.5 min-w-0 flex-1 overflow-hidden">
        <span class="text-xs font-semibold text-primary truncate leading-none">{{ headline }}</span>
        <span class="text-xs text-muted-foreground/80 truncate leading-snug">{{ subline }}</span>
      </div>

      <!-- Dismiss -->
      <button
        class="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
        :title="t('link_preview_remove') || 'Remove preview'"
        @click="emit('dismiss')"
      >
        <XIcon class="w-3.5 h-3.5" />
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { LinkIcon, Loader2Icon, XIcon } from "lucide-vue-next";
import type { LinkPreview } from "@argon/glue";
import { useLocale } from "@/store/system/localeStore";

const props = defineProps<{
  visible: boolean;
  loading: boolean;
  url: string | null;
  preview: LinkPreview | null;
}>();

const emit = defineEmits<(e: "dismiss") => void>();

const { t } = useLocale();

const imageFailed = ref(false);
watch(() => props.preview?.imageUrl, () => { imageFailed.value = false; });

const host = computed(() => {
  try {
    return props.url ? new URL(props.url).hostname : "";
  } catch {
    return props.url ?? "";
  }
});

const headline = computed(() => {
  if (props.preview) return props.preview.title || props.preview.siteName || host.value;
  return t("link_preview") || "Link preview";
});

const subline = computed(() => {
  if (props.preview) return props.preview.description || props.preview.siteName || props.url || "";
  return props.loading ? (t("link_preview_loading") || "Getting link info…") : (props.url ?? "");
});
</script>
