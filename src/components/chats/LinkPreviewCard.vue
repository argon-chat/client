<template>
  <a
    class="lp-card"
    :class="{ 'lp-card--thumb': layout === 'thumb' }"
    :href="preview.url"
    :title="preview.url"
    @click.prevent.stop="open"
  >
    <span class="lp-accent" :style="{ backgroundColor: accent || 'hsl(var(--primary))' }" />

    <span class="lp-body">
      <span v-if="preview.siteName" class="lp-site" :style="{ color: accent || 'hsl(var(--primary))' }">
        {{ preview.siteName }}
      </span>
      <span v-if="preview.title" class="lp-title">{{ preview.title }}</span>
      <span v-if="preview.description" class="lp-desc">{{ preview.description }}</span>

      <!-- Wide pictures go under the text, like a photo; the same node measures the image first. -->
      <span v-if="showImage && layout !== 'thumb'" class="lp-image" :class="{ 'lp-image--measuring': layout === 'measuring' }">
        <img :src="preview.imageUrl!" alt="" loading="lazy" @load="onImageLoad" @error="imageFailed = true" />
      </span>
    </span>

    <!-- Small or square pictures sit beside the text, like an icon. -->
    <span v-if="showImage && layout === 'thumb'" class="lp-thumb">
      <img :src="preview.imageUrl!" alt="" loading="lazy" @error="imageFailed = true" />
    </span>
  </a>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { openExternalUrl } from "@/lib/linkPreview/openExternal";

interface PreviewLike {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
  canonicalUrl: string | null;
}

const props = defineProps<{
  preview: PreviewLike;
  /** The sender's colour, as the reply bar uses it; the primary colour when absent. */
  accent?: string;
}>();

// The crawler stores the picture scaled to fit 1200×630 and never enlarged, so its natural size is
// an honest measure: a wide picture is a cover image, a small or square one is a logo or an icon.
type Layout = "measuring" | "large" | "thumb";

const LARGE_MIN_WIDTH = 400;
const LARGE_MIN_RATIO = 1.25;

const layout = ref<Layout>("measuring");
const imageFailed = ref(false);

const showImage = computed(() => !!props.preview.imageUrl && !imageFailed.value);

watch(() => props.preview.imageUrl, () => {
  layout.value = "measuring";
  imageFailed.value = false;
});

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  layout.value = w >= LARGE_MIN_WIDTH && h > 0 && w / h >= LARGE_MIN_RATIO ? "large" : "thumb";
}

function open() {
  openExternalUrl(props.preview.url);
}
</script>

<style scoped>
.lp-card {
  display: flex;
  align-items: stretch;
  gap: 10px;
  max-width: 100%;
  padding: 6px 10px 6px 0;
  border-radius: 8px;
  background: hsl(var(--foreground) / 0.04);
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s;
  white-space: normal;
}

.lp-card:hover {
  background: hsl(var(--foreground) / 0.08);
}

.lp-accent {
  flex-shrink: 0;
  width: 3px;
  border-radius: 999px;
  margin-left: 0;
}

.lp-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lp-site {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lp-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.lp-desc {
  font-size: 13px;
  line-height: 1.4;
  color: hsl(var(--foreground) / 0.8);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.lp-image {
  display: block;
  margin-top: 6px;
  border-radius: 8px;
  overflow: hidden;
  background: hsl(var(--muted));
}

.lp-image img {
  display: block;
  width: 100%;
  max-height: 280px;
  object-fit: cover;
}

/* Until the picture is measured it takes no room, so the text does not jump when it becomes a thumb. */
.lp-image--measuring {
  height: 0;
  margin: 0;
  visibility: hidden;
}

.lp-thumb {
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
  background: hsl(var(--muted));
  align-self: flex-start;
  margin-top: 2px;
}

.lp-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
