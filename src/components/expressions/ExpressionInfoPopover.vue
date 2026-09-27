<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { PopoverAnchor } from "reka-ui";
import { CheckIcon, CopyIcon, GlobeIcon, PackageOpenIcon } from "lucide-vue-next";
import { Popover, PopoverContent, PopoverTrigger } from "@argon/ui/popover";
import { Button } from "@argon/ui/button";
import StickerView from "@/components/expressions/StickerView.vue";
import { useExpressionResolver } from "@/lib/expressions/resolver";
import {
  EXPRESSION_INFO_SPACE,
  canOpenExpressionPack,
  openExpressionPack,
  resolveExpressionInfo,
  type ExpressionInfoSpace,
  type ExpressionInfoTarget,
} from "@/lib/expressions/expressionInfo";
import { animationsEnabled } from "@/lib/expressions/settings";
import { itemMedia } from "@/lib/chat/customEmoji";
import type { ExpressionMedia } from "@/lib/expressions/types";
import { db } from "@/store/db/dexie";
import { cdnCrossOrigin, cdnUrl } from "@/store/system/fileStorage";
import { useLocale } from "@/store/system/localeStore";

/**
 * Where a custom emoji or sticker comes from: the item large, its name, its pack and its space.
 *
 * The default slot is the trigger: one element, which gets the click and `aria-haspopup`. With
 * `manual` the slot is only the anchor and the popover opens through `open` (a reaction chip, whose
 * click stays the toggle).
 */
const props = defineProps<{
  target: ExpressionInfoTarget | null;
  /** Drawn when the item is not loaded here: what the message itself carries. */
  media?: ExpressionMedia | null;
  manual?: boolean;
}>();

const open = defineModel<boolean>("open", { default: false });

const { t } = useLocale();
const resolver = useExpressionResolver();
const contextSpace = inject(EXPRESSION_INFO_SPACE, null);

const space = ref<ExpressionInfoSpace | null>(null);
const item = computed(() => (props.target ? resolver.itemById(props.target.itemId) : null));
const spaceId = computed(() => item.value?.spaceId ?? props.target?.spaceId ?? null);

// Membership is the user's own row for that space; read when shown, not for every emoji on screen.
let lookup = 0;
watch(
  [open, spaceId],
  async ([isOpen, id]) => {
    const n = ++lookup;
    if (!isOpen || !id) return;
    const row = await db.servers.get(id).catch(() => undefined);
    if (n === lookup) space.value = row ?? null;
  },
  { immediate: true },
);

const info = computed(() =>
  props.target ? resolveExpressionInfo(props.target, resolver, space.value, contextSpace?.value ?? null) : null,
);
const media = computed(() => (info.value?.item ? itemMedia(info.value.item) : (props.media ?? null)));
const isSticker = computed(() => props.target?.kind === "sticker");
const title = computed(() => info.value?.label ?? t(isSticker.value ? "sticker" : "reaction_custom_unknown"));
const canOpen = computed(() => {
  const pack = info.value?.openPack;
  return !!pack && canOpenExpressionPack(pack.packId, pack.spaceId);
});

const avatarFailed = ref(false);
const avatarFileId = computed(() => info.value?.space?.avatarFileId ?? null);
watch(avatarFileId, () => (avatarFailed.value = false));
const avatarUrl = computed(() => (avatarFileId.value && !avatarFailed.value ? cdnUrl(avatarFileId.value) : null));

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
async function copyName() {
  const text = info.value?.copyText;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), 1500);
}
onBeforeUnmount(() => clearTimeout(copiedTimer));

function openPack() {
  const pack = info.value?.openPack;
  if (pack && openExpressionPack(pack)) open.value = false;
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverAnchor v-if="manual" as-child><slot /></PopoverAnchor>
    <PopoverTrigger v-else as-child><slot /></PopoverTrigger>
    <PopoverContent
      side="top"
      :side-offset="6"
      class="w-64 p-3 rounded-xl"
      :aria-label="title"
      data-testid="expression-info"
    >
      <template v-if="info">
        <div class="flex flex-col items-center gap-2 text-center">
          <div class="flex items-center justify-center" :class="isSticker ? 'h-24' : 'h-16'">
            <StickerView
              v-if="media"
              :media="media"
              :size="isSticker ? 96 : 64"
              :autoplay="animationsEnabled"
              loop
              group="expression-info"
              role="img"
              :aria-label="title"
            />
          </div>
          <div class="w-full min-w-0">
            <p class="text-sm font-semibold truncate" :title="title" data-testid="expression-info-label">{{ title }}</p>
            <p v-if="info.packTitle" class="text-xs text-muted-foreground truncate" data-testid="expression-info-pack">
              {{ t("expression_info_pack") }} <span class="font-medium text-foreground/80">{{ info.packTitle }}</span>
            </p>
          </div>
        </div>

        <div class="mt-3 flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5" data-testid="expression-info-space">
          <template v-if="info.space">
            <span class="w-7 h-7 rounded-md shrink-0 overflow-hidden bg-primary/15 text-primary text-xs font-semibold flex items-center justify-center" aria-hidden="true">
              <img
                v-if="avatarUrl"
                :src="avatarUrl"
                :crossorigin="cdnCrossOrigin(avatarUrl)"
                alt=""
                class="w-full h-full object-cover"
                @error="avatarFailed = true"
              />
              <template v-else>{{ info.space.name.trim().charAt(0).toUpperCase() }}</template>
            </span>
            <div class="min-w-0 text-left">
              <p class="text-[11px] leading-tight text-muted-foreground">
                {{ info.here ? t("expression_info_from_this_space") : t("expression_info_from_space") }}
              </p>
              <p class="text-sm font-medium truncate leading-tight" data-testid="expression-info-space-name">{{ info.space.name }}</p>
            </div>
          </template>
          <template v-else>
            <GlobeIcon class="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p class="text-xs text-muted-foreground text-left" data-testid="expression-info-other-space">{{ t("expression_info_other_space") }}</p>
          </template>
        </div>

        <div v-if="info.copyText || canOpen" class="mt-2 flex gap-2">
          <Button v-if="info.copyText" size="xs" variant="secondary" class="flex-1 gap-1.5" :title="info.copyText" data-testid="expression-info-copy" @click="copyName">
            <CheckIcon v-if="copied" class="w-3.5 h-3.5" aria-hidden="true" />
            <CopyIcon v-else class="w-3.5 h-3.5" aria-hidden="true" />
            {{ copied ? t("copied") : t("expression_info_copy_name") }}
          </Button>
          <Button v-if="canOpen" size="xs" class="flex-1 gap-1.5" data-testid="expression-info-open-pack" @click="openPack">
            <PackageOpenIcon class="w-3.5 h-3.5" aria-hidden="true" />
            {{ t("expression_info_open_pack") }}
          </Button>
        </div>
      </template>
    </PopoverContent>
  </Popover>
</template>
