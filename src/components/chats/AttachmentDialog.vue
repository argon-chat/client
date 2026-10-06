<template>
  <Dialog :open="open" @update:open="(v) => { if (!v) $emit('close') }">
    <DialogContent
      class="attach-dialog max-w-[520px] gap-0 p-0 overflow-x-hidden"
      :show-close-button="false"
      data-testid="attachment-dialog"
      @open-auto-focus="onOpenAutoFocus"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <TooltipProvider :delay-duration="300" :skip-delay-duration="150">
        <header class="attach-header">
          <DialogTitle class="attach-title text-[15px] leading-5 font-semibold" data-testid="attach-title">{{ title }}</DialogTitle>
          <div class="attach-header-actions">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button type="button" class="attach-icon-btn" :aria-label="t('attach_more')" data-testid="attach-menu">
                  <EllipsisVerticalIcon class="size-[18px]" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" :side-offset="6" class="min-w-[200px]">
                <DropdownMenuCheckboxItem
                  v-if="fileToggle"
                  :model-value="fileToggle.checked"
                  :disabled="fileToggle.disabled"
                  data-testid="video-send-as-file"
                  @update:model-value="onSendAsFile"
                >
                  {{ fileToggle.label }}
                </DropdownMenuCheckboxItem>
                <DropdownMenuItem data-testid="attach-add-files" @select="$emit('add-more')">
                  <PlusIcon aria-hidden="true" />
                  {{ t('attach_add_files') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DialogClose as-child>
              <button type="button" class="attach-icon-btn" :aria-label="t('close')" data-testid="attach-close">
                <XIcon class="size-[18px]" aria-hidden="true" />
              </button>
            </DialogClose>
          </div>
        </header>

        <!-- The stage: the media, and every decision about it sitting on it. -->
        <div
          v-if="selectedFile"
          class="attach-stage"
          :class="{ 'attach-stage--file': stageKind === 'file' }"
          :style="{ '--stage-ar': String(stageAspect) }"
        >
          <img
            v-if="stageKind === 'image'"
            :src="selectedFile.previewUrl!"
            alt=""
            class="stage-media"
            draggable="false"
            @load="onImageLoad"
          />

          <div v-else-if="stageKind === 'video'" class="stage-video" data-testid="attachment-video-preview">
            <img v-if="selectedFile.previewUrl" :src="selectedFile.previewUrl" alt="" class="stage-media" draggable="false" />
            <FilmIcon v-else class="stage-placeholder" aria-hidden="true" />

            <div v-if="playSrc && stageGeometry" class="stage-video-frame" :style="stageGeometry.frame">
              <video
                ref="videoRef"
                class="stage-video-el"
                :class="{ 'is-visible': videoShown }"
                :style="stageGeometry.viewBox ? `object-view-box: ${stageGeometry.viewBox}` : undefined"
                :src="playSrc"
                :loop="!selectedVideo?.prefs.trim"
                muted
                playsinline
                disablepictureinpicture
                preload="auto"
                data-testid="attachment-video-player"
                @loadedmetadata="onLoadedMetadata"
                @playing="onPlaying"
                @pause="onPause"
                @timeupdate="onTimeUpdate"
                @ended="onEnded"
                @error="onVideoError"
              />
            </div>

            <button
              v-if="canPlay"
              type="button"
              class="stage-hit"
              :aria-label="playing ? t('video_player_pause') : t('video_player_play')"
              data-testid="attachment-video-toggle"
              @click="togglePlay"
            />
            <span v-if="canPlay && !playing && !wantPlay" class="stage-play" aria-hidden="true">
              <PlayIcon class="stage-play-icon" />
            </span>

            <div
              v-if="videoShown"
              class="stage-progress"
              :class="{ 'stage-progress--reset': progressReset }"
              data-testid="attachment-video-timeline"
              aria-hidden="true"
            >
              <div class="stage-progress-fill" :style="{ transform: `scaleX(${progress})` }" />
            </div>
          </div>

          <div v-else class="stage-file">
            <span class="stage-file-icon">
              <FileTextIcon v-if="selectedFile.file.type === 'application/pdf'" aria-hidden="true" />
              <FileIcon v-else aria-hidden="true" />
            </span>
            <span class="stage-file-name">{{ selectedFile.file.name }}</span>
            <span class="stage-file-size">{{ formatSize(selectedFile.file.size) }}</span>
          </div>

          <!-- Chips over the media -->
          <div v-if="stageKind !== 'file'" class="stage-chips stage-chips--top">
            <span v-if="selectedVideo" class="chip" data-testid="video-duration">{{ durationText }}</span>
            <div class="chip-group" :data-testid="selectedVideo ? 'video-options' : undefined">
              <Popover v-if="showQuality" v-model:open="qualityOpen">
                <PopoverTrigger as-child>
                  <button
                    type="button"
                    class="chip chip--button"
                    :aria-label="t('attach_quality_chip', { quality: qualityChipLabel })"
                    data-testid="video-quality"
                  >
                    <span>{{ qualityChipLabel }}</span>
                    <ChevronDownIcon class="chip-chevron" :class="{ 'is-open': qualityOpen }" aria-hidden="true" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  :side-offset="8"
                  :collision-padding="12"
                  class="attach-quality w-[220px] p-1 duration-150 ease-out"
                  @open-auto-focus="onQualityOpenFocus"
                >
                  <ListboxRoot ref="qualityListRef" :model-value="qualityValue" highlight-on-hover @update:model-value="onQuality">
                    <ListboxContent class="outline-none" :aria-label="t('video_send_quality')">
                      <ListboxItem
                        v-for="row in qualityRows"
                        :key="row.value"
                        :value="row.value"
                        :disabled="row.disabled"
                        class="quality-row"
                        :data-testid="`video-quality-${row.value}`"
                      >
                        <span class="quality-row-check" aria-hidden="true">
                          <CheckIcon v-if="row.value === qualityValue" />
                        </span>
                        <span class="quality-row-label">{{ row.label }}</span>
                        <span v-if="row.detail" class="quality-row-detail">{{ row.detail }}</span>
                      </ListboxItem>
                    </ListboxContent>
                  </ListboxRoot>
                </PopoverContent>
              </Popover>

              <Tooltip v-if="showSound">
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    class="chip chip--button chip--icon"
                    :aria-pressed="selectedVideo!.prefs.mute"
                    :aria-label="t('video_send_mute')"
                    data-testid="video-mute"
                    @click="$emit('video-prefs', selectedIndex, { mute: !selectedVideo!.prefs.mute })"
                  >
                    <VolumeXIcon v-if="selectedVideo!.prefs.mute" aria-hidden="true" />
                    <Volume2Icon v-else aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" class="attach-tip">
                  {{ selectedVideo!.prefs.mute ? t('attach_sound_turn_on') : t('attach_sound_turn_off') }}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    class="chip chip--button chip--icon"
                    :aria-disabled="editBlockText ? 'true' : undefined"
                    :aria-label="t('edit')"
                    :data-testid="stageKind === 'video' ? 'video-edit' : 'image-edit'"
                    @click="openEditor"
                  >
                    <PencilIcon aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" class="attach-tip max-w-[260px]">{{ editBlockText || t('edit') }}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div v-if="selectedVideo && (sizeText || reasonText)" class="stage-chips stage-chips--bottom">
            <Tooltip v-if="reasonText">
              <TooltipTrigger as-child>
                <span class="chip chip--warn" tabindex="0" data-testid="video-reason">
                  <TriangleAlertIcon class="chip-warn-icon" aria-hidden="true" />
                  <span v-if="sizeText" data-testid="video-size">{{ sizeText }}</span>
                  <span v-if="sizeText" class="chip-sep" aria-hidden="true">·</span>
                  <span class="chip-reason">{{ reasonShort }}</span>
                  <span class="sr-only">{{ reasonText }}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" class="attach-tip max-w-[300px]">{{ reasonText }}</TooltipContent>
            </Tooltip>
            <span v-else class="chip" data-testid="video-size">{{ sizeText }}</span>
          </div>
        </div>

        <!-- The batch: one tile per file, the selected one on the stage -->
        <div v-if="files.length > 1" class="attach-strip">
          <div class="strip-list" role="listbox" aria-orientation="horizontal" :aria-label="t('attach_strip_label')">
            <button
              v-for="(file, i) in files"
              :key="keyOf(file)"
              :ref="(el) => setTileRef(el as HTMLElement | null, i)"
              type="button"
              role="option"
              class="strip-thumb"
              :class="{ active: i === selectedIndex }"
              :aria-selected="i === selectedIndex"
              :aria-label="file.file.name"
              aria-keyshortcuts="Delete"
              :tabindex="i === selectedIndex ? 0 : -1"
              @click="selectedIndex = i"
              @keydown="onTileKeydown($event, i)"
            >
              <img v-if="(isImage(file) || isVideo(file)) && file.previewUrl" :src="file.previewUrl" alt="" class="strip-thumb-img" draggable="false" />
              <FilmIcon v-else-if="isVideo(file)" class="strip-thumb-icon" aria-hidden="true" />
              <FileTextIcon v-else-if="file.file.type === 'application/pdf'" class="strip-thumb-icon" aria-hidden="true" />
              <FileIcon v-else class="strip-thumb-icon" aria-hidden="true" />
              <span v-if="file.video" class="strip-thumb-badge" aria-hidden="true">
                <PlayIcon class="strip-thumb-badge-icon" />{{ tileDuration(file) }}
              </span>
              <span class="strip-remove" aria-hidden="true" :title="t('remove')" @click.stop="removeAt(i)">
                <XIcon />
              </span>
            </button>
          </div>
          <button type="button" class="strip-add" :aria-label="t('attach_add_files')" data-testid="attach-strip-add" @click="$emit('add-more')">
            <PlusIcon aria-hidden="true" />
          </button>
        </div>

        <div class="attach-caption">
          <EnterText
            ref="captionInputRef"
            :reply-to="null"
            :space-id="spaceId"
            :receiver-id="receiverId"
            caption-mode
            @submit="send"
          />
        </div>

        <footer class="attach-footer">
          <span class="attach-meta" data-testid="attach-meta">{{ meta }}</span>
          <div class="attach-actions">
            <Button variant="ghost" size="sm" class="attach-btn" @click="$emit('close')">{{ t('cancel') }}</Button>
            <Button size="sm" class="attach-btn gap-1.5" data-testid="attach-send" @click="send">
              <SendHorizonalIcon class="size-4" aria-hidden="true" />
              {{ t('send') }}
            </Button>
          </div>
        </footer>
      </TooltipProvider>

      <Transition name="attach-drop">
        <div v-if="isDragging" class="attach-drop" aria-hidden="true">
          <div class="attach-drop-inner">
            <PlusIcon class="size-7" />
            <span>{{ t('drop_to_add') }}</span>
          </div>
        </div>
      </Transition>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch } from "vue";
import { usePreferredReducedMotion } from "@vueuse/core";
import { ListboxContent, ListboxItem, ListboxRoot } from "reka-ui";
import { Button } from "@argon/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@argon/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@argon/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@argon/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@argon/ui/tooltip";
import {
  CheckIcon,
  ChevronDownIcon,
  EllipsisVerticalIcon,
  FileIcon,
  FileTextIcon,
  FilmIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SendHorizonalIcon,
  TriangleAlertIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
} from "lucide-vue-next";
import { checkCapabilities, videoEditBlock, type PlatformCapabilities } from "@argon/media-editor";
import type { PendingAttachment, PendingVideo, PendingVideoPrefs } from "@/composables/useAttachmentUpload";
import {
  estimateOutputBytes,
  planVideo,
  type VideoCrop,
  type VideoEncoderAvailability,
  type VideoPlan,
  type VideoQuality,
  type VideoRotation,
} from "@/lib/video/plan";
import { videoCodecAvailability } from "@/lib/video/codecs";
import { qualityRungs } from "@/lib/attachments/videoEdit";
import { DEFAULT_UPLOAD_LIMITS, formatLimitBytes, formatLimitDuration } from "@/lib/attachments/uploadLimits";
import type { IMessageEntity } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { useLocale } from "@/store/system/localeStore";
import EnterText from "./EnterText.vue";

const { t } = useLocale();

const props = defineProps<{
  files: PendingAttachment[];
  open: boolean;
  /** The space of a channel composer; absent in a direct chat. */
  spaceId?: Guid;
  /** The peer of a direct chat, so the caption composer knows it needs no permissions. */
  receiverId?: Guid;
}>();

const emit = defineEmits<{
  (e: "send", text: string, entities: IMessageEntity[]): void;
  (e: "close"): void;
  (e: "add-more"): void;
  (e: "remove", index: number): void;
  (e: "add-files", files: FileList): void;
  (e: "replace-file", index: number, file: File, previewUrl: string): void;
  (e: "open-editor", index: number, src: string, mediaType: "image" | "video"): void;
  (e: "video-prefs", index: number, patch: Partial<Pick<PendingVideoPrefs, "quality" | "mute" | "sendAsFile">>): void;
}>();

const captionInputRef = ref<InstanceType<typeof EnterText> | null>(null);
const selectedIndex = ref(0);
const isDragging = ref(false);
const qualityOpen = ref(false);

const selectedFile = computed(() => props.files[selectedIndex.value] ?? null);
/** The selected file's video state (a video the probe could read); nothing is compressed before Send. */
const selectedVideo = computed<PendingVideo | null>(() => selectedFile.value?.video ?? null);

watch(() => props.open, (v) => {
  qualityOpen.value = false;
  if (v) {
    selectedIndex.value = 0;
    nextTick(() => {
      captionInputRef.value?.clear();
      captionInputRef.value?.focus();
    });
  }
});

// The caption takes focus on opening, not the first button of the header.
function onOpenAutoFocus(e: Event) {
  e.preventDefault();
  captionInputRef.value?.focus();
}

watch(() => props.files.length, (len) => {
  if (selectedIndex.value >= len) selectedIndex.value = Math.max(0, len - 1);
});

watch(selectedIndex, () => (qualityOpen.value = false));

function isImage(file: PendingAttachment): boolean {
  return file.file.type.startsWith("image/") && !!file.previewUrl;
}

function isVideo(file: PendingAttachment): boolean {
  return !!file.video || (file.file.type.startsWith("video/") && !!file.previewUrl);
}

const stageKind = computed<"image" | "video" | "file">(() => {
  const file = selectedFile.value;
  if (file && isImage(file)) return "image";
  if (file && isVideo(file)) return "video";
  return "file";
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// Plural forms by the CLDR category of the document's language; every locale has all four keys.
const pluralRules = new Map<string, Intl.PluralRules>();
function pluralForm(count: number): "one" | "few" | "many" | "other" {
  const lang = (typeof document !== "undefined" && document.documentElement.lang) || "en";
  let rules = pluralRules.get(lang);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(lang);
    } catch {
      rules = new Intl.PluralRules("en");
    }
    pluralRules.set(lang, rules);
  }
  const category = rules.select(count);
  return category === "one" || category === "few" || category === "many" ? category : "other";
}

// --- How each file goes ---

const isEdited = (prefs: PendingVideoPrefs) => !!(prefs.trim || prefs.crop || prefs.rotate || prefs.flip);

/** Sent as its own bytes, untouched: a video the user (or its plan) sends as a plain file. */
function goesRaw(v: PendingVideo): boolean {
  return v.prefs.sendAsFile && !isEdited(v.prefs) && !v.render;
}

function kindOf(file: PendingAttachment): "videos" | "photos" | "files" {
  if (file.video) return file.video.prefs.sendAsFile ? "files" : "videos";
  if (isImage(file)) return "photos";
  return "files";
}

/** What a file adds to the message: a video's expected output, else its bytes. */
function bytesOf(file: PendingAttachment): { bytes: number; estimated: boolean } {
  const v = file.video;
  if (v && !goesRaw(v) && v.plan) return { bytes: estimateOutputBytes(v.plan), estimated: true };
  return { bytes: file.file.size, estimated: false };
}

const title = computed(() => {
  const count = props.files.length;
  if (count > 1) return t(`attach_send_files_${pluralForm(count)}`, { count });
  const kind = props.files[0] ? kindOf(props.files[0]) : "files";
  return kind === "videos" ? t("attach_send_video") : kind === "photos" ? t("attach_send_photo") : t("attach_send_file");
});

const meta = computed(() => {
  const files = props.files;
  if (!files.length) return "";
  const kinds = new Set(files.map(kindOf));
  const kind = kinds.size === 1 ? [...kinds][0] : "files";
  const count = files.length;
  let total = 0;
  let estimated = false;
  for (const file of files) {
    const part = bytesOf(file);
    total += part.bytes;
    estimated ||= part.estimated;
  }
  const size = estimated ? t("video_send_estimated_size", { size: formatSize(total) }) : formatSize(total);
  return `${t(`attach_meta_${kind}_${pluralForm(count)}`, { count })} · ${size}`;
});

// --- Video: length, size, why it goes as a file ---

const durationText = computed(() => {
  const v = selectedVideo.value;
  if (!v) return "";
  return formatDuration(v.plan?.durationMs ?? (v.prefs.trim ? v.prefs.trim.endMs - v.prefs.trim.startMs : v.probe.durationMs));
});

function tileDuration(file: PendingAttachment): string {
  const v = file.video;
  if (!v) return "";
  return formatDuration(v.prefs.trim ? v.prefs.trim.endMs - v.prefs.trim.startMs : v.probe.durationMs);
}

const sizeText = computed(() => {
  const v = selectedVideo.value;
  const file = selectedFile.value;
  if (!v || !file) return "";
  if (goesRaw(v)) return t("attach_size_file", { size: formatSize(file.file.size) });
  if (v.plan) return t("video_send_estimated_size", { size: formatSize(estimateOutputBytes(v.plan)) });
  return "";
});

const REASON_KEYS: Record<string, [full: string, short: string]> = {
  "no-encoder": ["video_send_reason_no_encoder", "video_send_short_no_encoder"],
  undecodable: ["video_send_reason_undecodable", "video_send_short_undecodable"],
  "too-large": ["video_send_reason_too_large", "video_send_short_too_large"],
  "user-original": ["video_send_reason_original", "video_send_short_original"],
  "too-long": ["video_send_reason_too_long", "video_send_short_too_long"],
};

/** Why the video cannot go as asked: [the full sentence, the chip's few words]. */
const reason = computed<[string, string] | null>(() => {
  const v = selectedVideo.value;
  if (!v) return null;
  const limits = v.limits ?? { maxBytes: DEFAULT_UPLOAD_LIMITS.videoMaxBytes, maxDurationMs: DEFAULT_UPLOAD_LIMITS.videoMaxDurationMs };
  const params = { limit: formatLimitBytes(limits.maxBytes), duration: formatLimitDuration(limits.maxDurationMs) };
  if (v.fileReason) {
    const [full, short] = REASON_KEYS[v.fileReason] ?? REASON_KEYS["too-large"];
    return [t(full, params), t(short, params)];
  }
  if (v.error === "invalid-trim") return [t("video_send_reason_invalid_trim"), t("video_send_short_invalid_trim")];
  // Planned a rung lower to fit the target's size limit.
  if (v.plan?.downscaledToFit && !v.prefs.sendAsFile) {
    const height = Math.min(v.plan.width, v.plan.height);
    return [t("video_send_downscaled", { height }), t("video_send_short_downscaled", { height })];
  }
  return null;
});
const reasonText = computed(() => reason.value?.[0] ?? "");
const reasonShort = computed(() => reason.value?.[1] ?? "");

// --- Video: quality ---

// What this browser can encode, for each rung's estimate; asked once (the library caches it).
const encoders = shallowRef<VideoEncoderAvailability | null>(null);
let encodersAsked = false;
watch(
  selectedVideo,
  (v) => {
    if (!v || encodersAsked) return;
    encodersAsked = true;
    videoCodecAvailability()
      .then((a) => (encoders.value = { avc: a.avc, aac: a.aac, memoryBudgetBytes: a.memoryBudgetBytes }))
      .catch(() => {});
  },
  { immediate: true },
);

/** The frame the rungs are measured on: the crop's, or the source's. */
function frameOf(v: PendingVideo): { width: number; height: number } {
  const crop = v.prefs.crop;
  return crop ? { width: crop.width, height: crop.height } : { width: v.probe.width, height: v.probe.height };
}

function planAt(v: PendingVideo, quality: VideoQuality): VideoPlan | null {
  const enc = encoders.value;
  if (!enc) return null;
  const p = v.prefs;
  try {
    return planVideo(
      toRaw(v.probe),
      {
        quality,
        mute: p.mute,
        trim: p.trim ? { ...p.trim } : null,
        crop: p.crop ? { ...p.crop } : null,
        rotate: p.rotate ?? 0,
        flip: p.flip ?? false,
        maxBytes: (v.limits ?? { maxBytes: DEFAULT_UPLOAD_LIMITS.videoMaxBytes }).maxBytes,
      },
      enc,
    );
  } catch {
    return null;
  }
}

interface QualityRow {
  value: string;
  label: string;
  detail: string;
  disabled: boolean;
}

const estimateOf = (plan: VideoPlan | null) =>
  plan && plan.mode !== "original" ? t("video_send_estimated_size", { size: formatSize(estimateOutputBytes(plan)) }) : "";

/** Auto, then each rung the (cropped) source reaches from the top, then Original. Nothing is upscaled. */
const qualityRows = computed<QualityRow[]>(() => {
  const v = selectedVideo.value;
  if (!v) return [];
  const frame = frameOf(v);
  const rungs = qualityRungs(frame.width, frame.height);
  const autoHeight = Math.min(1080, Math.min(frame.width, frame.height));
  const rows: QualityRow[] = [
    { value: "auto", label: t("attach_quality_auto", { height: autoHeight }), detail: estimateOf(planAt(v, "auto")), disabled: false },
  ];
  for (const rung of [...rungs].reverse()) {
    const plan = planAt(v, rung);
    const tooLarge = !!plan && (plan.downscaledToFit || plan.reason === "too-large");
    rows.push({
      value: String(rung),
      label: t("video_send_quality_rung", { height: rung }),
      detail: tooLarge ? t("attach_quality_too_large") : estimateOf(plan),
      disabled: tooLarge,
    });
  }
  const original = planAt(v, "original");
  const asFile = !!original && original.mode === "original";
  rows.push({
    value: "original",
    label: asFile ? t("attach_quality_original_file") : t("video_send_quality_original"),
    detail: asFile ? formatSize(v.probe.size) : estimateOf(original) || formatSize(v.probe.size),
    disabled: false,
  });
  return rows;
});

const qualityValue = computed(() => {
  const value = String(selectedVideo.value?.prefs.quality ?? "auto");
  return qualityRows.value.some((row) => row.value === value) ? value : "auto";
});

/** What goes out: the plan's height when there is one, else the setting. */
const qualityChipLabel = computed(() => {
  const v = selectedVideo.value;
  if (!v) return "";
  const quality = v.prefs.quality;
  if (quality === "original") return t("video_send_quality_original");
  const plan = v.plan;
  if (plan && plan.mode !== "original") return t("video_send_quality_rung", { height: Math.min(plan.width, plan.height) });
  return quality === "auto" ? t("video_send_quality_auto") : t("video_send_quality_rung", { height: quality });
});

const qualityListRef = ref<{ highlightSelected: (event?: Event, scroll?: boolean) => Promise<void> } | null>(null);

function onQualityOpenFocus(e: Event) {
  e.preventDefault();
  void nextTick(() => qualityListRef.value?.highlightSelected());
}

function onQuality(value: unknown) {
  qualityOpen.value = false;
  if (typeof value !== "string" || value === qualityValue.value) return;
  const quality: VideoQuality = value === "auto" || value === "original" ? value : (Number(value) as VideoQuality);
  emit("video-prefs", selectedIndex.value, { quality });
}

/** Quality matters while it goes as a video, or while Original is what makes it a file. */
const showQuality = computed(() => {
  const v = selectedVideo.value;
  if (!v) return false;
  if (v.fileReason) return v.fileReason === "user-original";
  return !v.prefs.sendAsFile;
});

const showSound = computed(() => {
  const v = selectedVideo.value;
  return !!v && v.probe.hasAudio && !v.prefs.sendAsFile;
});

// --- "Send as file" in the ⋮ menu: this video, or every video of the batch ---

const batchVideos = computed(() =>
  props.files.flatMap((file, index) => (file.video ? [{ video: file.video, index }] : [])),
);

const fileToggle = computed<{ label: string; checked: boolean | "indeterminate"; disabled: boolean } | null>(() => {
  const videos = batchVideos.value;
  if (videos.length > 1) {
    const asFiles = videos.filter(({ video }) => video.prefs.sendAsFile).length;
    return {
      label: t("attach_send_all_as_files"),
      checked: asFiles === videos.length ? true : asFiles ? "indeterminate" : false,
      disabled: videos.every(({ video }) => !!video.fileReason),
    };
  }
  const v = selectedVideo.value;
  if (!v) return null;
  return { label: t("video_send_as_file"), checked: v.prefs.sendAsFile, disabled: !!v.fileReason };
});

function onSendAsFile(value: boolean | "indeterminate") {
  const sendAsFile = value === true;
  const videos = batchVideos.value;
  if (videos.length > 1) {
    for (const { video, index } of videos) {
      if (!video.fileReason && video.prefs.sendAsFile !== sendAsFile) emit("video-prefs", index, { sendAsFile });
    }
  } else if (selectedVideo.value) {
    emit("video-prefs", selectedIndex.value, { sendAsFile });
  }
}

// --- The editor ---

// The editor needs WebGPU and an H.264 encoder, and takes videos up to 100 MB.
const capabilities = shallowRef<PlatformCapabilities | null>(null);
onMounted(() => {
  void checkCapabilities().then((caps) => (capabilities.value = caps)).catch(() => {});
});

const EDIT_BLOCK_KEYS = {
  "no-gpu": "video_send_edit_no_gpu",
  "no-encoder": "video_send_edit_no_encoder",
  "too-large": "video_send_edit_too_large",
} as const;

const editBlockText = computed(() => {
  const file = selectedFile.value;
  if (!file || !isVideo(file)) return "";
  const caps = capabilities.value;
  if (!caps) return t("video_send_edit_checking");
  const block = videoEditBlock((file.video?.source ?? file.file).size, caps);
  return block ? t(EDIT_BLOCK_KEYS[block]) : "";
});

function openEditor() {
  const file = selectedFile.value;
  if (!file) return;
  if (isImage(file)) {
    emit("open-editor", selectedIndex.value, file.previewUrl!, "image");
  } else if (isVideo(file)) {
    if (editBlockText.value) return;
    // The editor always works on the file as picked; an earlier edit is reopened from its state.
    const videoSrc = URL.createObjectURL(file.video?.source ?? file.file);
    emit("open-editor", selectedIndex.value, videoSrc, "video");
  }
}

function send() {
  const parsed = captionInputRef.value?.getParsedContent();
  emit("send", parsed?.text ?? "", parsed?.entities ?? []);
}

// --- The stage ---

const imageAspects = ref<Record<string, number>>({});

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  if (img.naturalWidth && img.naturalHeight) imageAspects.value = { ...imageAspects.value, [img.src]: img.naturalWidth / img.naturalHeight };
}

/** Width over height of what the stage shows; it sizes the stage between 260 and 380 px. */
const stageAspect = computed(() => {
  const file = selectedFile.value;
  if (!file) return 16 / 9;
  if (file.width && file.height) return file.width / file.height;
  const loaded = file.previewUrl ? imageAspects.value[file.previewUrl] : undefined;
  return loaded ?? 16 / 9;
});

const reducedMotion = usePreferredReducedMotion();
const videoRef = ref<HTMLVideoElement | null>(null);
const playSrc = ref<string | null>(null);
/** Shown over the poster once it plays (the crossfade); the poster stays until then. */
const videoShown = ref(false);
const playing = ref(false);
/** Asked to play and not paused since: no play glyph while it starts. */
const wantPlay = ref(false);
const videoFailed = ref(false);
/** Played fraction of the trimmed range; `progressReset` drops the transition when it wraps. */
const progress = ref(0);
const progressReset = ref(false);
let frameHandle = 0;

const viewBoxSupported = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("object-view-box", "inset(0%)");

/** A crop of the turned, mirrored frame, in the source's own frame (`width`×`height`). */
function cropInSource(crop: VideoCrop, width: number, height: number, rotate: VideoRotation, flip: boolean): VideoCrop {
  const turnedW = rotate % 180 ? height : width;
  const left = flip ? turnedW - crop.left - crop.width : crop.left;
  const { top, width: w, height: h } = crop;
  switch (rotate) {
    case 90:
      return { left: top, top: height - left - w, width: h, height: w };
    case 180:
      return { left: width - left - w, top: height - top - h, width: w, height: h };
    case 270:
      return { left: width - top - h, top: left, width: h, height: w };
    default:
      return { left, top, width: w, height: h };
  }
}

const pct = (part: number, whole: number) => `${((Math.max(0, part) / whole) * 100).toFixed(4)}%`;

/**
 * How the playing source is laid out to look like the edit: turned and mirrored with a transform,
 * cropped with object-view-box. Null when this browser cannot show the crop (the poster stays).
 */
const stageGeometry = computed(() => {
  const v = selectedVideo.value;
  if (!v) return null;
  const { width, height } = v.sourceProbe;
  const rotate = (v.prefs.rotate ?? 0) as VideoRotation;
  const flip = !!v.prefs.flip;
  const crop = v.prefs.crop ?? null;
  let viewBox: string | null = null;
  if (crop) {
    if (!viewBoxSupported || !width || !height) return null;
    const src = cropInSource(crop, width, height, rotate, flip);
    viewBox = `inset(${pct(src.top, height)} ${pct(width - src.left - src.width, width)} ${pct(height - src.top - src.height, height)} ${pct(src.left, width)})`;
  }
  const quarter = rotate % 180 !== 0;
  const transform = ["translate(-50%, -50%)", flip ? "scaleX(-1)" : "", rotate ? `rotate(${rotate}deg)` : ""].filter(Boolean).join(" ");
  return {
    frame: { width: quarter ? "100cqh" : "100%", height: quarter ? "100cqw" : "100%", transform },
    viewBox,
  };
});

/** The selected video plays here from the picked file, unless a painted edit stands in for it. */
const canPlay = computed(() => {
  const v = selectedVideo.value;
  return props.open && !!v && !v.render && !videoFailed.value && stageGeometry.value !== null;
});

function playRange(): { start: number; end: number } {
  const v = selectedVideo.value;
  const el = videoRef.value;
  const trim = v?.prefs.trim;
  if (trim) return { start: trim.startMs / 1000, end: trim.endMs / 1000 };
  const duration = el && Number.isFinite(el.duration) ? el.duration : (v?.sourceProbe.durationMs ?? 0) / 1000;
  return { start: 0, end: duration };
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function releasePlayback() {
  const el = videoRef.value as FrameCallbackVideo | null;
  if (el && frameHandle) el.cancelVideoFrameCallback?.(frameHandle);
  frameHandle = 0;
  el?.pause();
  if (playSrc.value) URL.revokeObjectURL(playSrc.value);
  playSrc.value = null;
  videoShown.value = false;
  playing.value = false;
  wantPlay.value = false;
  progress.value = 0;
  progressReset.value = false;
}

function startPlayback() {
  const v = selectedVideo.value;
  if (!v || playSrc.value) return;
  wantPlay.value = true;
  playSrc.value = URL.createObjectURL(toRaw(v.source));
}

function resetPlayback() {
  releasePlayback();
  videoFailed.value = false;
  if (canPlay.value && reducedMotion.value !== "reduce") startPlayback();
}

watch(
  [() => props.open, selectedVideo, () => selectedVideo.value?.render ?? null, () => selectedVideo.value?.source ?? null, () => stageGeometry.value === null],
  resetPlayback,
  { immediate: true },
);

// A new trim starts the loop over from its start.
watch(
  () => selectedVideo.value?.prefs.trim,
  () => {
    const el = videoRef.value;
    if (el && playSrc.value) el.currentTime = playRange().start;
  },
);

onBeforeUnmount(releasePlayback);

function onLoadedMetadata() {
  const el = videoRef.value as FrameCallbackVideo | null;
  if (!el) return;
  const { start } = playRange();
  if (start > 0) el.currentTime = start;
  // Frame-accurate end of a trimmed loop where the browser reports frames; timeupdate otherwise.
  if (selectedVideo.value?.prefs.trim && el.requestVideoFrameCallback) {
    const tick = (_now: number, meta: { mediaTime: number }) => {
      if (videoRef.value !== el || !playSrc.value) return;
      const range = playRange();
      if (meta.mediaTime >= range.end - 0.02) el.currentTime = range.start;
      frameHandle = el.requestVideoFrameCallback!(tick);
    };
    frameHandle = el.requestVideoFrameCallback(tick);
  }
  if (wantPlay.value) void el.play().catch(() => (wantPlay.value = false));
}

function onPlaying() {
  playing.value = true;
  videoShown.value = true;
}

function onPause() {
  playing.value = false;
}

function onTimeUpdate() {
  const el = videoRef.value;
  if (!el) return;
  const { start, end } = playRange();
  let time = el.currentTime;
  if (selectedVideo.value?.prefs.trim && time >= end - 0.05) {
    el.currentTime = start;
    time = start;
  }
  const span = end - start;
  const next = span > 0 ? Math.min(1, Math.max(0, (time - start) / span)) : 0;
  progressReset.value = next < progress.value;
  progress.value = next;
}

function onEnded() {
  const el = videoRef.value;
  if (!el) return;
  el.currentTime = playRange().start;
  void el.play().catch(() => {});
}

function onVideoError(e: Event) {
  // Only the source playing now: a released one may still report its abort.
  if (!playSrc.value || (e.target as HTMLVideoElement).getAttribute("src") !== playSrc.value) return;
  videoFailed.value = true;
  releasePlayback();
}

function togglePlay() {
  if (!canPlay.value) return;
  if (!playSrc.value) {
    startPlayback();
    return;
  }
  const el = videoRef.value;
  if (!el) return;
  if (el.paused) {
    wantPlay.value = true;
    void el.play().catch(() => (wantPlay.value = false));
  } else {
    wantPlay.value = false;
    el.pause();
  }
}

// --- The strip ---

const keys = new WeakMap<object, number>();
let nextKey = 0;
function keyOf(file: PendingAttachment): number {
  const raw = toRaw(file);
  let key = keys.get(raw);
  if (key === undefined) keys.set(raw, (key = nextKey++));
  return key;
}

const tileRefs: (HTMLElement | null)[] = [];
function setTileRef(el: HTMLElement | null, i: number) {
  tileRefs[i] = el;
}

function focusTile(i: number) {
  void nextTick(() => {
    if (props.files.length > 1) tileRefs[i]?.focus();
    else captionInputRef.value?.focus();
  });
}

function removeAt(i: number) {
  if (i < selectedIndex.value) selectedIndex.value--;
  emit("remove", i);
}

function onTileKeydown(e: KeyboardEvent, i: number) {
  const last = props.files.length - 1;
  let next: number | null = null;
  if (e.key === "ArrowRight") next = Math.min(last, i + 1);
  else if (e.key === "ArrowLeft") next = Math.max(0, i - 1);
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = last;
  else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    removeAt(i);
    focusTile(Math.min(selectedIndex.value, last - 1));
    return;
  }
  if (next === null) return;
  e.preventDefault();
  selectedIndex.value = next;
  focusTile(next);
}

// --- Drag-and-drop ---

function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes("Files")) isDragging.value = true;
}

function onDragLeave(e: DragEvent) {
  const el = e.currentTarget as HTMLElement;
  if (!el.contains(e.relatedTarget as Node)) isDragging.value = false;
}

function onDrop(e: DragEvent) {
  isDragging.value = false;
  if (e.dataTransfer?.files?.length) emit("add-files", e.dataTransfer.files);
}
</script>

<style scoped>
.attach-dialog {
  position: relative;
}

.attach-dialog ::selection {
  background: hsl(var(--ring) / 0.3);
}

/* ── Header ─────────────────────────────────────────────── */

.attach-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 8px 0 16px;
}

.attach-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.attach-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out, transform 120ms ease-out;
}

.attach-icon-btn:hover,
.attach-icon-btn[data-state="open"] {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.attach-icon-btn:active {
  transform: scale(0.94);
}

.attach-icon-btn:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 1px;
}

/* ── Stage ──────────────────────────────────────────────── */

.attach-stage {
  position: relative;
  height: clamp(260px, calc(min(520px, 100vw - 32px) / var(--stage-ar, 1.7778)), 380px);
  background: #000;
  overflow: hidden;
  flex: none;
}

.attach-stage--file {
  height: 260px;
}

.stage-media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}

.stage-placeholder {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 48px;
  height: 48px;
  margin: -24px 0 0 -24px;
  color: rgb(255 255 255 / 0.5);
}

.stage-video {
  position: absolute;
  inset: 0;
  container-type: size;
}

.stage-video-frame {
  position: absolute;
  top: 50%;
  left: 50%;
}

.stage-video-el {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0;
  transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1);
}

.stage-video-el.is-visible {
  opacity: 1;
}

.stage-hit {
  position: absolute;
  inset: 0;
  z-index: 1;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}

.stage-hit:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.9);
}

.stage-play {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin: -26px 0 0 -26px;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.55);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  color: #fff;
  pointer-events: none;
}

.stage-play-icon {
  width: 22px;
  height: 22px;
  margin-left: 2px;
  fill: currentColor;
}

/* How far the preview has played: the chat bubble's thin line along the bottom edge. */
.stage-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  z-index: 2;
  background: rgba(255, 255, 255, 0.35);
  box-shadow: 0 -10px 14px rgba(0, 0, 0, 0.25);
  pointer-events: none;
}

.stage-progress-fill {
  height: 100%;
  background: #fff;
  transform-origin: left center;
  transition: transform 0.25s linear;
}

.stage-progress--reset .stage-progress-fill {
  transition: none;
}

.stage-file {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  color: #fff;
  text-align: center;
}

.stage-file-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: 6px;
  border-radius: 14px;
  background: rgb(255 255 255 / 0.1);
}

.stage-file-icon svg {
  width: 26px;
  height: 26px;
}

.stage-file-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
}

.stage-file-size {
  font-size: 12.5px;
  color: rgb(255 255 255 / 0.6);
  font-variant-numeric: tabular-nums;
}

/* ── Chips over the media (Telegram's: white on a dark, blurred pill in both themes) ── */

.stage-chips {
  position: absolute;
  left: 12px;
  right: 12px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  pointer-events: none;
}

.stage-chips--top {
  top: 12px;
}

.stage-chips--bottom {
  bottom: 12px;
}

.stage-chips > *,
.chip-group > * {
  pointer-events: auto;
}

.chip-group {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  max-width: 100%;
  padding: 0 10px;
  border: 0;
  border-radius: 14px;
  background: rgb(0 0 0 / 0.55);
  /* A hairline edge: the pill still reads where it sits on a letterbox's black. */
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  color: #fff;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition: background-color 120ms ease-out, opacity 120ms ease-out, transform 120ms ease-out;
}

.chip svg {
  width: 16px;
  height: 16px;
  flex: none;
}

.chip--button {
  cursor: pointer;
}

.chip--button:hover,
.chip--button[data-state="open"] {
  background: rgb(0 0 0 / 0.7);
}

.chip--button:active {
  transform: scale(0.96);
}

.chip:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

.chip--button[aria-disabled="true"] {
  opacity: 0.5;
  cursor: not-allowed;
}

.chip--button[aria-disabled="true"]:hover {
  background: rgb(0 0 0 / 0.55);
}

.chip--button[aria-disabled="true"]:active {
  transform: none;
}

.chip--icon {
  width: 28px;
  padding: 0;
  justify-content: center;
}

.chip-chevron {
  margin-right: -2px;
  transition: transform 150ms ease-out;
}

.chip-chevron.is-open {
  transform: rotate(180deg);
}

/* Cannot go as asked: amber, with the problem named. */
.chip--warn {
  background: rgb(128 76 0 / 0.88);
  cursor: default;
  min-width: 0;
}

.chip-warn-icon {
  color: #fcd34d;
}

.chip-sep {
  opacity: 0.7;
}

.chip-reason {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Quality popover ────────────────────────────────────── */

:global(.attach-quality .quality-row) {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  outline: none;
  user-select: none;
  transition: background-color 120ms ease-out;
}

:global(.attach-quality .quality-row[data-highlighted]) {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}

:global(.attach-quality .quality-row[data-state="checked"]) {
  font-weight: 500;
}

:global(.attach-quality .quality-row[data-disabled]) {
  opacity: 0.5;
  cursor: not-allowed;
}

:global(.attach-quality .quality-row-check) {
  display: flex;
  width: 16px;
  flex: none;
}

:global(.attach-quality .quality-row-check svg) {
  width: 16px;
  height: 16px;
}

:global(.attach-quality .quality-row-label) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.attach-quality .quality-row-detail) {
  flex: none;
  font-size: 12px;
  font-weight: 400;
  color: hsl(var(--muted-foreground));
  font-variant-numeric: tabular-nums;
}

:global(.attach-tip) {
  font-size: 12.5px;
  line-height: 1.4;
}

/* ── Strip ──────────────────────────────────────────────── */

.attach-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px 4px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: hsl(var(--muted-foreground) / 0.35) transparent;
}

.attach-strip::-webkit-scrollbar {
  height: 6px;
}

.attach-strip::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: hsl(var(--muted-foreground) / 0.35);
}

.strip-list {
  display: flex;
  gap: 8px;
}

.strip-thumb {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 120ms ease-out, transform 120ms ease-out;
}

.strip-thumb:hover {
  box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--muted-foreground) / 0.35);
}

.strip-thumb.active {
  box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--primary));
}

.strip-thumb:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring));
}

.strip-thumb:active {
  transform: scale(0.97);
}

.strip-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
}

.strip-thumb-icon {
  width: 22px;
  height: 22px;
}

.strip-thumb-badge {
  position: absolute;
  left: 4px;
  bottom: 4px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 16px;
  padding: 0 4px 0 3px;
  border-radius: 8px;
  background: rgb(0 0 0 / 0.6);
  color: #fff;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.strip-thumb-badge-icon {
  width: 9px;
  height: 9px;
  fill: currentColor;
}

.strip-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 9px;
  background: rgb(0 0 0 / 0.6);
  color: #fff;
  opacity: 0;
  cursor: pointer;
  transition: opacity 120ms ease-out, background-color 120ms ease-out;
}

.strip-remove svg {
  width: 12px;
  height: 12px;
}

.strip-thumb:hover .strip-remove,
.strip-thumb:focus-visible .strip-remove {
  opacity: 1;
}

.strip-remove:hover {
  background: rgb(0 0 0 / 0.8);
}

.strip-add {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border: 1.5px dashed hsl(var(--muted-foreground) / 0.45);
  border-radius: 10px;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: border-color 120ms ease-out, color 120ms ease-out, background-color 120ms ease-out, transform 120ms ease-out;
}

.strip-add svg {
  width: 20px;
  height: 20px;
}

.strip-add:hover {
  border-color: hsl(var(--foreground) / 0.6);
  color: hsl(var(--foreground));
  background: hsl(var(--muted) / 0.5);
}

.strip-add:active {
  transform: scale(0.97);
}

.strip-add:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}

/* ── Caption and footer ─────────────────────────────────── */

.attach-caption {
  margin: 12px 16px 0;
  border-radius: 10px;
  background: hsl(var(--muted) / 0.6);
  transition: box-shadow 120ms ease-out;
}

.attach-caption:focus-within {
  box-shadow: 0 0 0 1px hsl(var(--ring) / 0.55);
}

.attach-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px 16px;
}

.attach-meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: hsl(var(--muted-foreground));
  font-variant-numeric: tabular-nums;
}

.attach-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

.attach-btn {
  transition: background-color 120ms ease-out, transform 120ms ease-out;
}

.attach-btn:active {
  transform: scale(0.98);
}

.attach-btn:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}

/* ── Drop overlay ───────────────────────────────────────── */

.attach-drop {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  padding: 8px;
  background: hsl(var(--background) / 0.88);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  pointer-events: none;
}

.attach-drop-inner {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 2px dashed hsl(var(--ring) / 0.6);
  border-radius: calc(var(--radius) - 4px);
  color: hsl(var(--foreground));
  font-size: 14px;
  font-weight: 500;
}

.attach-drop-enter-active,
.attach-drop-leave-active {
  transition: opacity 150ms ease-out;
}

.attach-drop-enter-from,
.attach-drop-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .stage-video-el,
  .stage-progress-fill,
  .chip,
  .chip-chevron,
  .strip-thumb,
  .strip-remove,
  .strip-add,
  .attach-icon-btn,
  .attach-btn {
    transition: none;
  }
}
</style>
