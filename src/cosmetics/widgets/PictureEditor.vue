<script setup lang="ts">
import { computed, ref } from "vue";
import { logger } from "@argon/core";
import { Input } from "@argon/ui/input";
import { useToast } from "@argon/ui/toast";
import { IconLoader2, IconPhotoUp } from "@tabler/icons-vue";
import { cdnUrl } from "@/store/system/fileStorage";
import { useLocale } from "@/store/system/localeStore";
import { useApi } from "@/store/system/apiStore";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { uploadFile } from "@/lib/uploadFile";
import { MEDIA_BYTE_LIMIT, MEDIA_MIME, type PictureContent } from "@/cosmetics/kinds/widget-picture";

/**
 * Putting a picture on a card, at the size the card is.
 *
 * <b>The editor is the card.</b> A thumbnail beside a text field made every card in the board editor
 * look the same and left most of a tall one empty, which is the opposite of what a board editor is
 * for — the thing being arranged is how these look next to each other.
 *
 * The upload is the one an avatar takes: same ticket, same limits, same moderation, because it is the
 * same class of thing — a picture other people are shown.
 */
const props = defineProps<{ content: PictureContent }>();

const emit = defineEmits<{ "update:content": [value: PictureContent] }>();

const { t } = useLocale();
const { toast } = useToast();
const api = useApi();
const cosmetics = useCosmeticsStore();

const uploading = ref(false);
const picker = ref<HTMLInputElement | null>(null);

const src = computed(() => props.content.fileId ? cdnUrl(props.content.fileId) : null);

const moving = computed(() => props.content.kind === "video");

function write(next: Partial<PictureContent>): void {
  emit("update:content", { ...props.content, ...next });
}

function refuse(message: string): void {
  toast({ title: t("error"), description: message, variant: "destructive" });
}

async function pick(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  input.value = "";

  if (!file) return;

  // Checked here as well as on the way in. The server is what enforces it; this is so somebody does
  // not watch a twenty-megabyte upload run to the end before being told.
  if (file.size > MEDIA_BYTE_LIMIT) {
    refuse(t("cosmetic_picture_too_large", { mb: Math.round(MEDIA_BYTE_LIMIT / 1024 / 1024) }));
    return;
  }

  const loadoutId = cosmetics.editing;

  if (!loadoutId) return;

  uploading.value = true;

  try {
    const begin = await api.cosmeticsInteraction.BeginUploadWidgetPicture(loadoutId);
    const { blobId } = await uploadFile(begin, file, "WidgetPicture");

    const result = await api.cosmeticsInteraction.CompleteUploadWidgetPicture(loadoutId, blobId);

    if (!result.isSuccessWidgetPicture()) {
      refuse(t("cosmetic_picture_failed"));
      return;
    }

    write({ fileId: result.fileId, kind: file.type.startsWith("video/") ? "video" : "image" });
  } catch (error) {
    logger.warn("A card picture could not be uploaded", error);
    refuse(`${error}`);
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="picture-editor">
    <button class="picture-well" :disabled="uploading" :title="t('cosmetic_picture_choose')" @click="picker?.click()">
      <video
        v-if="src && moving"
        :src="src"
        class="picture-media"
        :style="{ objectFit: content.fit ?? 'cover' }"
        autoplay
        loop
        muted
        playsinline
      />
      <img
        v-else-if="src"
        :src="src"
        class="picture-media"
        :style="{ objectFit: content.fit ?? 'cover' }"
        alt=""
        draggable="false"
      />

      <span class="picture-overlay" :class="{ 'picture-overlay--empty': !src }">
        <IconLoader2 v-if="uploading" class="w-6 h-6 animate-spin" />
        <IconPhotoUp v-else class="w-6 h-6" />
      </span>
    </button>

    <input ref="picker" type="file" :accept="MEDIA_MIME" class="hidden" @change="pick" />

    <div class="picture-controls">
      <Input
        :model-value="content.caption ?? ''"
        :placeholder="t('cosmetic_picture_caption')"
        :maxlength="80"
        class="h-7 text-xs"
        @update:model-value="write({ caption: String($event) })"
      />

      <div class="picture-fits">
        <button
          v-for="fit in (['cover', 'contain'] as const)"
          :key="fit"
          class="picture-fit"
          :class="{ 'picture-fit--active': (content.fit ?? 'cover') === fit }"
          @click="write({ fit })"
        >{{ t(`cosmetic_picture_fit_${fit}`) }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picture-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

/* Everything the card has left after the controls, so it is judged at the size it will be. */
.picture-well {
  position: relative;
  flex: 1;
  min-height: 0;
  border-radius: 9px;
  border: 1px dashed hsl(var(--border));
  background: hsl(var(--secondary) / 0.4);
  overflow: hidden;
}

.picture-well:hover {
  border-color: hsl(var(--primary));
}

.picture-media {
  display: block;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
}

.picture-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  background: hsl(var(--background) / 0.55);
  color: hsl(var(--foreground));
  transition: opacity 0.15s ease;
}

/* Nothing to cover, so the prompt is the content. */
.picture-overlay--empty {
  opacity: 1;
  background: none;
  color: hsl(var(--muted-foreground));
}

.picture-well:hover .picture-overlay,
.picture-well:disabled .picture-overlay {
  opacity: 1;
}

.picture-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.picture-fits {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
}

.picture-fit {
  padding: 3px 8px;
  border-radius: 7px;
  border: 1px solid hsl(var(--border) / 0.7);
  font-size: 0.66rem;
  color: hsl(var(--muted-foreground));
}

.picture-fit--active {
  border-color: hsl(var(--primary));
  color: hsl(var(--foreground));
  background: hsl(var(--primary) / 0.12);
}
</style>
