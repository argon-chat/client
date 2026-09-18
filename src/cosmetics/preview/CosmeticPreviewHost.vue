<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useTheme } from "@argon/theme";
import { reduceMotion } from "@/composables/useReducedMotion";
import { setFileUrlOverride } from "@/store/system/fileStorage";
import { cosmeticKinds } from "@/cosmetics/registry";
import { previewProfileFor, type PreviewResolution } from "@/cosmetics/preview/previewProfile";
import {
  PREVIEW_CHANNEL,
  PREVIEW_PROTOCOL,
  isPreviewCommand,
  type PreviewCommand,
  type PreviewKindReport,
  type PreviewReadyEvent,
  type PreviewResultEvent,
  type PreviewStage,
} from "@/cosmetics/preview/protocol";
import ProfileCardStage from "@/cosmetics/preview/stages/ProfileCardStage.vue";
import MemberRowStage from "@/cosmetics/preview/stages/MemberRowStage.vue";
import MessageStage from "@/cosmetics/preview/stages/MessageStage.vue";
import AvatarStage from "@/cosmetics/preview/stages/AvatarStage.vue";

/**
 * The page the admin console frames to see what a cosmetic actually looks like.
 *
 * <b>It exists because the console must not draw cosmetics itself.</b> A renderer over there would
 * be a copy of this one, copies drift, and an operator approving a drifted drawing publishes
 * something nobody has ever seen. So the row is posted here and drawn by the files that draw a real
 * profile — the same kind modules, the same primitives, the same compositing.
 *
 * It holds no session and asks for nothing: it draws what it is handed, over public files, and
 * answers with a verdict. That verdict is the second reason it exists — the client's own parse is a
 * gate the server's validator is not, and it is the gate that decides whether anybody ever sees the
 * row.
 */

/**
 * Room around the drawing, so a frame hanging past a card is not cut off by the window.
 *
 * Modest, because it comes out of the same width the card is fitted into: every pixel here is a
 * pixel the drawing is shrunk by in a narrow panel.
 */
const PAGE_PADDING = 16;

/** What a refusal needs: the sentence saying so, and nothing else. */
const REFUSAL_HEIGHT = 140;

const STAGES = {
  profileCard: ProfileCardStage,
  memberRow: MemberRowStage,
  message: MessageStage,
  avatar: AvatarStage,
} as const;

const command = shallowRef<PreviewCommand | null>(null);

/** Who asked, so the answer goes back to them rather than to anyone listening. */
const consoleWindow = shallowRef<Window | null>(null);
const consoleOrigin = ref<string>("*");

const stageBox = ref<HTMLElement | null>(null);
const drawnSize = ref({ width: 0, height: 0 });

const theme = useTheme();

const resolution = computed<PreviewResolution | null>(() => {
  const asked = command.value;

  if (!asked) return null;

  return previewProfileFor(asked.item, {
    bio: asked.sample.bio ?? null,
    avatarFileId: asked.sample.avatarFileId ?? null,
    primaryColor: asked.sample.primaryColor ?? null,
    accentColor: asked.sample.accentColor ?? null,
  });
});

const zoom = computed(() => {
  const asked = command.value?.zoom ?? 1;

  return Number.isFinite(asked) && asked > 0 ? Math.min(4, Math.max(0.25, asked)) : 1;
});

/** How wide this page is, kept current because the panel framing it is resizable. */
const frameWidth = ref(window.innerWidth);

/**
 * What it is actually drawn at.
 *
 * <b>Life size, unless life size does not fit.</b> A profile card is 320 pixels before a frame hangs
 * anything outside it, and the panel in the editor is often narrower than that — drawn at 100% there,
 * the card's own edges sit behind a scrollbar, and a frame's edges are the whole of what somebody is
 * looking at. So anything at or below life size is shrunk to fit the box it is in.
 *
 * Zooming in is the one case that overrides this: past 100% the operator has asked to see a part of
 * it closely, and the page scrolls rather than defeating the request by shrinking it again.
 */
const scale = computed(() => {
  const asked = zoom.value;

  if (asked > 1 || drawnSize.value.width === 0) return asked;

  const room = frameWidth.value - PAGE_PADDING * 2;

  if (room <= 0) return asked;

  return Math.min(asked, room / drawnSize.value.width);
});

/**
 * Where to draw it: what was asked for, unless this row does not appear there.
 *
 * The console offers only the stages a previous answer reported, but the two cross — a kind changes
 * under an operator who had a tab open — and falling back is better than an empty box.
 */
const stage = computed<PreviewStage>(() => {
  const offered = resolution.value?.stages ?? [];
  const asked = command.value?.stage;

  if (asked && offered.includes(asked)) return asked;

  return offered[0] ?? "profileCard";
});

const drawable = computed(() => resolution.value?.verdict === "rendered" && resolution.value.profile !== null);

/**
 * Whether anybody is framing this page.
 *
 * Only to answer somebody who opened it directly and is looking at an empty screen. Framed, waiting
 * silently is right: the console draws its own "waiting" over the top of this.
 */
const standalone = window.parent === window;

/**
 * What the chosen stage is given, and only what it takes.
 *
 * The card is the one that draws a whole person — a username, a bio, the colours under everything
 * worn; the other three draw a name and a face. Spread over all of them, the card's extra props
 * would land on a row's root element as stray HTML attributes.
 */
const stageProps = computed(() => {
  const sample = command.value?.sample;

  const worn = {
    profile: resolution.value?.profile ?? null,
    displayName: sample?.displayName ?? "",
    avatarFileId: sample?.avatarFileId ?? null,
  };

  if (stage.value !== "profileCard") return worn;

  return {
    ...worn,
    username: sample?.username ?? "",
    bio: sample?.bio ?? null,
    primaryColor: sample?.primaryColor ?? null,
    accentColor: sample?.accentColor ?? null,
  };
});

/** Said on the page as well as in the answer: an empty frame reads as a broken one. */
const refusal = computed(() => {
  switch (resolution.value?.verdict) {
    case "unknown-kind":
      return "This build of the client ships no file for that kind, so it cannot draw it.";
    case "payload-rejected":
      return "The renderer refused this payload. A profile wearing it would draw nothing here.";
    case "no-renderer":
      return "Nothing in this build draws a row of this kind.";
    default:
      return "";
  }
});

function kindReport(): PreviewKindReport[] {
  return cosmeticKinds.map(kind => ({
    key: kind.key,
    primitive: kind.primitive,
    surfaces: [...kind.surfaces],
    facets: (kind.facets ?? []).map(facet => ({ id: facet.id, optionKindKey: facet.optionKindKey })),
    bare: kind.bare === true,
  }));
}

function announce(): void {
  const ready: PreviewReadyEvent = {
    channel: PREVIEW_CHANNEL,
    v: PREVIEW_PROTOCOL,
    type: "ready",
    kinds: kindReport(),
  };

  // To anyone framing this page, because until a command arrives there is no origin to answer to.
  // The message is a list of the kinds a public build ships, which is not a secret and cannot be
  // used to reach anything.
  window.parent?.postMessage(ready, "*");
}

/**
 * Files the browser would not load, named rather than left as a hole in the picture.
 *
 * <b>The failure this catches is silent by construction.</b> A picture that does not arrive is a
 * frame that draws nothing and a card with a broken glyph in the corner, and everything about the
 * row can be right while that happens — a stand whose files are behind a redirect this page's origin
 * will not follow, a file released from under the row, a base pointing at a server that is down. The
 * operator should be told which file and from where, not left comparing an empty card against a
 * payload that validates.
 */
const failedFiles = ref<string[]>([]);

/**
 * Files that have neither arrived nor failed, which is the same hole in the picture and a commoner
 * one: a stand whose api is restarting answers nothing at all, and the request simply hangs.
 */
const stalledFiles = ref(0);

/** How long a file is given before not having arrived is worth saying out loud. */
const FILE_PATIENCE_MS = 4000;

function fileWarnings(): string[] {
  const warnings: string[] = [];

  if (failedFiles.value.length > 0) {
    const shown = failedFiles.value.slice(0, 2).join(", ");
    const rest = failedFiles.value.length - 2;

    warnings.push(`The browser refused ${failedFiles.value.length} file(s) this row draws: ${shown}${rest > 0 ? ` and ${rest} more` : ""}.`);
  }

  if (stalledFiles.value > 0) {
    warnings.push(`${stalledFiles.value} file(s) this row draws have not arrived. The server they are read from may be down or restarting — what is drawn here is the row without them.`);
  }

  return warnings;
}

/** Whatever is still on its way after the drawing has had time to settle. */
function countStalled(): number {
  const element = stageBox.value;

  if (!element) return 0;

  let stalled = 0;

  for (const image of element.querySelectorAll("img")) {
    if (image.src && (!image.complete || image.naturalWidth === 0) && !failedFiles.value.includes(image.currentSrc || image.src)) {
      stalled += 1;
    }
  }

  return stalled;
}

function onFileError(event: Event): void {
  const target = event.target as HTMLImageElement | HTMLVideoElement | null;
  const source = target?.currentSrc || (target as HTMLImageElement | null)?.src;

  if (!source || failedFiles.value.includes(source)) return;

  failedFiles.value = [...failedFiles.value, source];

  answer();
}

function answer(): void {
  const found = resolution.value;

  if (!found) return;

  // Nothing drawn means nothing measured, and the last drawing's height would leave the console
  // holding a tall empty box. A refusal is a sentence, so it is given the height of one.
  const drawn = found.verdict === "rendered";

  const result: PreviewResultEvent = {
    channel: PREVIEW_CHANNEL,
    v: PREVIEW_PROTOCOL,
    type: "result",
    verdict: found.verdict,
    warnings: [...found.warnings, ...fileWarnings()],
    stages: found.stages,
    height: drawn
      ? Math.ceil(drawnSize.value.height * scale.value) + PAGE_PADDING * 2
      : REFUSAL_HEIGHT,
    scale: drawn ? scale.value : 1,
  };

  (consoleWindow.value ?? window.parent)?.postMessage(result, consoleOrigin.value);
}

/**
 * The base a file is fetched from, or null when what arrived is not one.
 *
 * <b>Checked because this page answers whoever frames it.</b> Nothing here is worth stealing — no
 * session, no storage, no credentials on a cross-origin image — but a base that is not an ordinary
 * web address has no honest use, and refusing it costs a line.
 */
function fileBaseOf(raw: string): string | null {
  try {
    const url = new URL(raw, window.location.href);

    return url.protocol === "https:" || url.protocol === "http:" ? url.href.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

function apply(asked: PreviewCommand, base: string): void {
  // The files of whichever stand the console administers. Set before anything is drawn, or the first
  // paint asks this build's own api for a file that only exists over there.
  setFileUrlOverride(fileId => `${base}/${fileId}`);

  // Page-local: the storage under this page is its own, so none of this reaches the client the
  // operator has open in another tab. See `isolatedStorage`.
  reduceMotion.value = !asked.motion;

  // The renderers read the ref; the class is the seam anything else on this page would key off. The
  // stages have no animation of their own today, so today the ref is what stops the movement.
  document.documentElement.classList.toggle("reduce-motion", !asked.motion);

  theme.applyTheme(asked.theme);
}

function onMessage(event: MessageEvent): void {
  if (!isPreviewCommand(event.data)) return;

  // A console of another age. Answering it in this one's terms would be worse than silence: what it
  // drew would look exactly as authoritative as what it should have drawn.
  if (event.data.v !== PREVIEW_PROTOCOL) return;

  // Without somewhere to read files from there is no drawing to make, so a command that does not
  // carry an ordinary web address is not half-applied — it is ignored, and the console times out.
  const base = fileBaseOf(event.data.fileBase);

  if (base === null) return;

  consoleWindow.value = (event.source as Window | null) ?? window.parent;
  consoleOrigin.value = event.origin && event.origin !== "null" ? event.origin : "*";

  // A new row, or the same one from somewhere else: whatever would not load before is not evidence
  // about what is being drawn now.
  failedFiles.value = [];
  stalledFiles.value = 0;

  if (patienceTimer !== null) clearTimeout(patienceTimer);

  patienceTimer = setTimeout(() => {
    const stalled = countStalled();

    if (stalled === stalledFiles.value) return;

    stalledFiles.value = stalled;
    answer();
  }, FILE_PATIENCE_MS);

  apply(event.data, base);
  command.value = event.data;
}

/**
 * The drawing's size, taken from the element itself.
 *
 * <b>Measured as well as observed, because an observer does not run on a page nobody is looking
 * at.</b> A `ResizeObserver` fires in the rendering steps, and a hidden tab has none — so a console
 * opened in a background tab would be told the drawing is nothing high and would frame it as a
 * sliver. `offsetHeight` forces the layout instead of waiting for one, and reads the untransformed
 * box, which is the same thing the observer reports.
 */
function measure(): void {
  const element = stageBox.value;

  if (!element) return;

  const width = element.offsetWidth;
  const height = element.offsetHeight;

  if (width === drawnSize.value.width && height === drawnSize.value.height) return;

  drawnSize.value = { width, height };
}

let observer: ResizeObserver | null = null;

let patienceTimer: ReturnType<typeof setTimeout> | null = null;

function onResize(): void {
  frameWidth.value = window.innerWidth;
}

onMounted(() => {
  // The product's appearance, not this operator's: the page's storage is empty, so everything here
  // falls back to what the client ships with.
  theme.applyAppearanceSettings();

  window.addEventListener("message", onMessage);
  window.addEventListener("resize", onResize);

  // Capture, because a picture that fails to load fires at the element and does not bubble.
  window.addEventListener("error", onFileError, true);

  observer = new ResizeObserver(entries => {
    const box = entries[0]?.contentRect;

    if (!box) return;

    drawnSize.value = { width: box.width, height: box.height };
  });

  announce();
});

watch(stageBox, element => {
  observer?.disconnect();

  if (element) observer?.observe(element);
});

// Both, and separately: the drawing settles after the answer (an image arrives, a face registers,
// a frame grows) and the height that went out with the verdict was the height of an empty box.
watch([resolution, drawnSize, scale, frameWidth], () => {
  void nextTick(() => {
    measure();
    answer();
  });
}, { deep: false });

onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  window.removeEventListener("resize", onResize);
  window.removeEventListener("error", onFileError, true);
  observer?.disconnect();

  if (patienceTimer !== null) clearTimeout(patienceTimer);

  setFileUrlOverride(null);
});
</script>

<template>
  <div class="preview-page" :style="{ padding: `${PAGE_PADDING}px` }">
    <div
      v-if="drawable"
      class="preview-fit"
      :style="{
        width: `${drawnSize.width * scale}px`,
        height: `${drawnSize.height * scale}px`,
      }"
    >
      <div
        ref="stageBox"
        class="preview-scale"
        :style="{ transform: `scale(${scale})` }"
      >
        <component :is="STAGES[stage]" v-bind="stageProps" />
      </div>
    </div>

    <p v-else-if="refusal" class="preview-refusal">{{ refusal }}</p>

    <p v-else-if="standalone && !command" class="preview-refusal">
      This page draws a cosmetic for the admin console, which frames it and posts it a row. On its
      own there is nothing for it to draw.
    </p>
  </div>
</template>

<style>
/* Unscoped on purpose: this is the page, not a component on one. */
html,
body {
  margin: 0;
  padding: 0;
  color: hsl(var(--foreground));
}

/*
 * Scrollable, and it has to be.
 *
 * The console sizes its frame from the height this page reports, so at life size there is never
 * anything to scroll. Zoomed in there is: three times a profile card is a thousand pixels across in
 * a panel a few hundred wide, and the part that goes over the edge is the fine edge somebody zoomed
 * in to look at.
 *
 * On the root alone. Set on both, `body` becomes a second scroller inside the first and the
 * horizontal overflow lands in the one nothing scrolls.
 */
html {
  overflow: auto;
}

#cosmetic-preview {
  min-height: 100vh;
}
</style>

<style scoped>
.preview-page {
  display: flex;
  min-height: 100vh;
  box-sizing: border-box;

  /*
   * The app's own background, painted here rather than on `body`.
   *
   * The product's stylesheet forces `body` transparent — the desktop window is a translucent
   * material and the page is what lets it through — so a background set there is thrown away, and
   * this page would be drawn on whatever the console happens to be. That matters more than it
   * sounds: a frame with soft edges or a name in a pale colour is a different object on white.
   */
  background: hsl(var(--background));
}

/*
 * A box the size of the scaled drawing, holding an unscaled one.
 *
 * `transform` does not change layout, so without this the page is laid out at 1× and a drawing at 2×
 * runs off it. The box takes the scaled measurements and the drawing is placed into its corner.
 */
.preview-fit {
  position: relative;
  flex: none;

  /*
   * Centred by its own margins rather than by the page's `justify-content`.
   *
   * A flex item centred by the container is pushed off both ends when it is wider than the
   * container, and the part pushed off the start is unreachable — no scroll goes back that far. Auto
   * margins collapse to nothing when there is no room, which leaves the whole drawing scrollable.
   */
  margin: auto;
}

.preview-scale {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  width: max-content;
}

.preview-refusal {
  max-width: 320px;
  margin: auto;
  text-align: center;
  font-size: 0.78rem;
  line-height: 1.5;
  color: hsl(var(--muted-foreground));
}
</style>
