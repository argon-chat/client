import { defineStore } from 'pinia';
import { ref, reactive, computed } from 'vue';
import { adjustmentsConfig, type AdjustmentKey } from '../adjustments';
import {
  isExpressionMode,
  type Vec2,
  type MediaType,
  type EditorLayer,
  type TextStyle,
  type BrushType,
  type RenderTransform,
  type EditorMode,
  type OutlineState,
  type MaskState,
  type MaskStroke,
  type MaskOp,
  type MaskRaster,
  type BackgroundRemover,
  type CutoutTool
} from '../types';
import type { BrushDrawnLine } from '../canvas/brushPainter';
import type { RenderingPayload } from '../webgpu/initWebGPU';
import { DEFAULT_TEXT_STYLE, DEFAULT_BRUSH } from '../constants';
import { deepEqualApprox, omitKeys } from '../comparison';
import { clamp } from '../geometry';
import { DEFAULT_OUTLINE_COLOR, OUTLINE_MAX_RADIUS, maskResolution } from '../mask/maskMath';
import type { CoverageRect } from '../selection/coverage';
import type { EraserSampling } from '../selection/backgroundEraser';
import { magicErase as computeMagicErase } from '../selection/magicEraser';
import { polygonArea } from '../selection/polygon';
import { readWorkingImage, type WorkingImage } from '../selection/workingImage';

// ─── History ───────────────────────────────────────────────────────

export const REMOVE_ARRAY_ITEM = 'SSBiZWxpZXZlIEkgY2FuIGZseSwgSSBiZWxpZXZlIEkgY2FuIHRvdWNoIHRoZSBza3kh';

export type HistoryItem = {
  path: (string | number)[];
  newValue: any;
  oldValue: any;
  findBy?: { id: any };
};

// ─── State types ───────────────────────────────────────────────────

export interface EditingMediaState {
  scale: number;
  rotation: number;
  translation: Vec2;
  flip: Vec2;
  perspective: Vec2;
  currentImageRatio: number;

  currentVideoTime: number;
  videoCropStart: number;
  videoCropLength: number;
  videoThumbnailPosition: number;
  videoMuted: boolean;
  videoQuality: number;

  adjustments: Record<AdjustmentKey, number>;

  curves: {
    r: Vec2;
    g: Vec2;
    b: Vec2;
  };

  selective: {
    hue: number;
    range: number;
    shift: number;
    sat: number;
    luma: number;
  };

  resizableLayers: EditorLayer[];
  brushDrawnLines: BrushDrawnLine[];

  /** Drawn under the image from its alpha (sticker and emoji modes). */
  outline: OutlineState;
  /** Multiplied into the image's alpha. */
  mask: MaskState;

  history: HistoryItem[];
  redoHistory: HistoryItem[];
}

export type BackgroundRemovalState = {
  status: 'idle' | 'running' | 'failed';
  progress: number;
};

export type CutoutOptions = {
  lassoMode: 'freehand' | 'polygon';
  /** Lasso and magnetic lasso, source pixels (0–20). */
  selectionFeather: number;
  /** Magnetic lasso: how far from the pointer an edge is looked for, CSS pixels. */
  edgeWidth: number;
  /** Magic eraser, 0–100. */
  magicTolerance: number;
  contiguous: boolean;
  /** Magic eraser, source pixels (0–20). */
  magicFeather: number;
  /** Background eraser diameter, CSS pixels. */
  eraserSize: number;
  /** Background eraser, 0–100. */
  eraserHardness: number;
  eraserTolerance: number;
  sampling: EraserSampling;
};

/** A closed lasso waiting for Keep / Erase, source pixels. */
export type PendingSelection = {
  points: Vec2[];
  /** Selects everything but the polygon. */
  inverted: boolean;
};

export const SELECTION_MAX_FEATHER = 20;

export interface MediaEditorUIState {
  isReady: boolean;
  pixelRatio: number;
  renderingPayload?: RenderingPayload;

  currentTab: string;
  cropTabAnimationProgress: number;

  mediaSize?: Vec2;
  mediaRatio?: number;
  canvasSize?: Vec2;
  fixedImageRatioKey?: string;
  finalTransform: RenderTransform;

  currentTextLayerInfo: TextStyle;
  selectedResizableLayer?: number;

  imageCanvas?: HTMLCanvasElement;
  brushCanvas?: HTMLCanvasElement;

  currentBrush: {
    color: string;
    size: number;
    brush: BrushType;
  };
  previewBrushSize?: number;

  resizeHandlesContainer?: HTMLDivElement;

  isAdjusting: boolean;
  isMoving: boolean;
  isPlaying: boolean;

  debugGizmos: boolean;
  gridOverlay: 'none' | 'thirds' | 'golden' | 'diagonal';
  showBeforeAfter: boolean;

  backgroundRemoval: BackgroundRemovalState;
  /** Erase / restore brush diameter, CSS pixels. */
  maskBrushSize: number;

  cutoutTool: CutoutTool | null;
  cutoutOptions: CutoutOptions;
  selection: PendingSelection | null;
  /** The magnetic lasso's edge map: being computed, usable, or unavailable (then it is a polygon lasso). */
  liveWire: 'idle' | 'preparing' | 'ready' | 'failed';
}

// ─── Defaults ──────────────────────────────────────────────────────

function getDefaultEditingMediaState(): EditingMediaState {
  return {
    scale: 1,
    rotation: 0,
    translation: [0, 0],
    flip: [1, 1],
    perspective: [0, 0],
    currentImageRatio: 0,

    currentVideoTime: 0,
    videoCropStart: 0,
    videoCropLength: 1,
    videoThumbnailPosition: 0,
    videoMuted: false,
    videoQuality: 0,

    adjustments: Object.fromEntries(
      adjustmentsConfig.map(entry => [entry.key, 0])
    ) as Record<AdjustmentKey, number>,

    curves: {
      r: [0, 0] as Vec2,
      g: [0, 0] as Vec2,
      b: [0, 0] as Vec2,
    },

    selective: {
      hue: 0,
      range: 0,
      shift: 0,
      sat: 0,
      luma: 0,
    },

    resizableLayers: [],
    brushDrawnLines: [],

    outline: { enabled: false, radius: 8, color: DEFAULT_OUTLINE_COLOR },
    mask: { source: null, feather: 0, strokes: [] },

    history: [],
    redoHistory: []
  };
}

function getDefaultUIState(): MediaEditorUIState {
  return {
    isReady: false,
    pixelRatio: window.devicePixelRatio,
    renderingPayload: undefined,

    currentTab: 'adjustments',
    cropTabAnimationProgress: 0,

    mediaSize: undefined,
    mediaRatio: undefined,
    canvasSize: undefined,
    fixedImageRatioKey: undefined,
    finalTransform: {
      flip: [1, 1],
      rotation: 0,
      scale: 1,
      translation: [0, 0]
    },

    currentTextLayerInfo: structuredClone(DEFAULT_TEXT_STYLE),
    selectedResizableLayer: undefined,

    // Both are full-resolution canvases, so reset() must drop them with the rest.
    imageCanvas: undefined,
    brushCanvas: undefined,

    currentBrush: structuredClone(DEFAULT_BRUSH),
    previewBrushSize: undefined,

    resizeHandlesContainer: undefined,

    isAdjusting: false,
    isMoving: false,
    isPlaying: false,

    debugGizmos: false,
    gridOverlay: 'thirds',
    showBeforeAfter: false,

    backgroundRemoval: { status: 'idle', progress: 0 },
    maskBrushSize: 40,

    cutoutTool: null,
    cutoutOptions: {
      lassoMode: 'freehand',
      selectionFeather: 0,
      edgeWidth: 10,
      magicTolerance: 25,
      contiguous: true,
      magicFeather: 0,
      eraserSize: 48,
      eraserHardness: 80,
      eraserTolerance: 30,
      sampling: 'once'
    },
    selection: null,
    liveWire: 'idle'
  };
}

let nextMaskSourceId = 1;

// ─── Store ─────────────────────────────────────────────────────────

export const useMediaEditorStore = defineStore('media-editor', () => {
  // Core props
  const mediaSrc = ref('');
  const mediaType = ref<MediaType>('image');
  const mode = ref<EditorMode>('full');

  // Rasters are large and immutable; the state (and so the history) holds only their ids.
  const maskSources = new Map<number, MaskRaster>();
  // The source at the mask's resolution, read back once for the smart erasers.
  let working: WorkingImage | null = null;

  // Editing state (media transforms, adjustments, layers, brushes, history)
  const mediaState = reactive<EditingMediaState>(getDefaultEditingMediaState());

  // UI state (canvas, tabs, tool selection)
  const uiState = reactive<MediaEditorUIState>(getDefaultUIState());

  // Snapshot of initial state for modification detection
  let initialSnapshot: EditingMediaState = structuredClone(getDefaultEditingMediaState());

  const keysToExcept = ['history', 'redoHistory', 'currentVideoTime'] as const;

  const hasModifications = computed(() => {
    return !deepEqualApprox(
      omitKeys(initialSnapshot, [...keysToExcept]),
      omitKeys(mediaState, [...keysToExcept])
    );
  });

  // Avatars and expressions are always re-encoded at their fixed size, even untouched.
  const canFinish = computed(() => {
    return mode.value === 'avatar' || isExpressionMode(mode.value) || hasModifications.value;
  });

  // ─── Actions ─────────────────────────────────────────────────────

  function init(options: {
    src: string;
    type: MediaType;
    mode?: EditorMode;
    initialState?: EditingMediaState;
    initialTab?: string;
  }) {
    mediaSrc.value = options.src;
    mediaType.value = options.type;
    mode.value = options.mode ?? 'full';
    maskSources.clear();
    working = null;

    // A state saved before a field existed still gets that field's default.
    const newState = options.initialState
      ? { ...getDefaultEditingMediaState(), ...structuredClone(options.initialState) }
      : getDefaultEditingMediaState();

    Object.assign(mediaState, newState);
    Object.assign(uiState, getDefaultUIState());

    if (options.initialTab) {
      uiState.currentTab = options.initialTab;
      if (options.initialTab === 'crop') {
        uiState.cropTabAnimationProgress = 1;
      }
    }

    initialSnapshot = structuredClone(newState);
  }

  function pushToHistory(item: HistoryItem) {
    mediaState.history.push(item);
    if (mediaState.redoHistory.length) {
      mediaState.redoHistory.splice(0, Infinity);
    }
  }

  function undo() {
    const item = mediaState.history.pop();
    if (!item) return;

    applyHistoryItem(item, false);
    mediaState.redoHistory.push(item);
  }

  function redo() {
    const item = mediaState.redoHistory.pop();
    if (!item) return;

    applyHistoryItem(item, true);
    mediaState.history.push(item);
  }

  function applyHistoryItem(item: HistoryItem, forward: boolean) {
    const path = [...item.path];
    if (!path.length) return;

    let obj: any = mediaState;
    for (let i = 0; i < path.length - 1; i++) {
      obj = obj[path[i]];
    }

    let key: any = path[path.length - 1];

    if (obj instanceof Array) {
      if (item.findBy) {
        key = obj.findIndex((v: any) => v?.id === item.findBy!.id);
      }
      if (key === -1) key = obj.length;

      const value = forward ? item.newValue : item.oldValue;
      const opposite = forward ? item.oldValue : item.newValue;

      if (value === REMOVE_ARRAY_ITEM) {
        obj.splice(key, 1);
      } else if (opposite === REMOVE_ARRAY_ITEM) {
        obj.splice(key, 0, value);
      } else {
        obj[key] = value;
      }
    } else {
      obj[key] = forward ? item.newValue : item.oldValue;
    }
  }

  function reset() {
    cancelBackgroundRemoval();
    Object.assign(mediaState, getDefaultEditingMediaState());
    Object.assign(uiState, getDefaultUIState());
    mediaSrc.value = '';
    mediaType.value = 'image';
    mode.value = 'full';
    maskSources.clear();
    working = null;
  }

  // ─── Outline and mask ────────────────────────────────────────────

  function setOutline<K extends keyof OutlineState>(key: K, value: OutlineState[K]) {
    const next = key === 'radius' ? clamp(Math.round(value as number), 0, OUTLINE_MAX_RADIUS) : value;
    const oldValue = mediaState.outline[key];
    if (oldValue === next) return;
    mediaState.outline[key] = next as OutlineState[K];
    pushToHistory({ path: ['outline', key], oldValue, newValue: next });
  }

  function addMaskSource(raster: MaskRaster): number {
    const id = nextMaskSourceId++;
    maskSources.set(id, raster);
    return id;
  }

  function getMaskSource(id: number | null): MaskRaster | null {
    return id === null ? null : maskSources.get(id) ?? null;
  }

  /** A new base for the mask (background removal); earlier strokes are kept on top of it. */
  function setMaskSource(id: number | null) {
    const oldValue = mediaState.mask.source;
    if (oldValue === id) return;
    mediaState.mask.source = id;
    pushToHistory({ path: ['mask', 'source'], oldValue, newValue: id });
  }

  function setMaskFeather(value: number) {
    const next = Math.max(0, Math.round(value));
    const oldValue = mediaState.mask.feather;
    if (oldValue === next) return;
    mediaState.mask.feather = next;
    pushToHistory({ path: ['mask', 'feather'], oldValue, newValue: next });
  }

  function addMaskOp(op: MaskOp) {
    mediaState.mask.strokes.push(op);
    pushToHistory({
      path: ['mask', 'strokes', mediaState.mask.strokes.length - 1],
      oldValue: REMOVE_ARRAY_ITEM,
      newValue: op
    });
  }

  function addMaskStroke(stroke: MaskStroke) {
    addMaskOp(stroke);
  }

  /** Erases inside or outside a closed polygon (source pixels), as one undoable step. */
  function eraseSelection(points: readonly Vec2[], region: 'inside' | 'outside', feather = 0): boolean {
    if (points.length < 3 || Math.abs(polygonArea(points)) < 1) return false;
    addMaskOp({
      kind: 'polygon',
      region,
      feather: clamp(Math.round(feather), 0, SELECTION_MAX_FEATHER),
      points: points.map((p) => [p[0], p[1]] as Vec2)
    });
    return true;
  }

  /**
   * Keep: erase everything but the selection; erase: erase the selection. With the selection
   * inverted, "the selection" is everything outside the polygon.
   */
  function applySelection(action: 'keep' | 'erase'): boolean {
    const selection = uiState.selection;
    if (!selection) return false;
    const selectedInside = !selection.inverted;
    const eraseInside = action === 'erase' ? selectedInside : !selectedInside;
    const done = eraseSelection(selection.points, eraseInside ? 'inside' : 'outside', uiState.cutoutOptions.selectionFeather);
    uiState.selection = null;
    return done;
  }

  /** A computed erase in a frame of `scale` pixels per source pixel, as one undoable step. */
  function addMaskErase(coverage: CoverageRect, scale: number): boolean {
    if (!coverage.width || !coverage.height || !(scale > 0)) return false;
    const raster = addMaskSource({ width: coverage.width, height: coverage.height, data: coverage.data });
    const { x, y, width, height } = coverage;
    addMaskOp({ kind: 'raster', mode: 'erase', raster, points: [[x / scale, y / scale], [(x + width) / scale, (y + height) / scale]] });
    return true;
  }

  /** The source at the mask's resolution; null until the image is loaded. */
  function getWorkingImage(): WorkingImage | null {
    if (working) return working;
    const image = uiState.renderingPayload?.media.image;
    const size = uiState.mediaSize;
    if (!image || !size) return null;
    working = readWorkingImage(image, size);
    return working;
  }

  /** For tests and hosts that already have the pixels. */
  function setWorkingImage(image: WorkingImage | null) {
    working = image;
  }

  /** The magic eraser clicked at `point` (source pixels), with the tab's options. */
  function magicErase(point: Vec2): boolean {
    const image = getWorkingImage();
    if (!image) return false;
    const o = uiState.cutoutOptions;
    const coverage = computeMagicErase(image, [point[0] * image.scale, point[1] * image.scale], {
      tolerance: o.magicTolerance,
      contiguous: o.contiguous,
      feather: o.magicFeather * image.scale
    });
    return coverage ? addMaskErase(coverage, image.scale) : false;
  }

  let removal: AbortController | null = null;

  /**
   * Runs the host's background removal on the source image and makes the result the mask's base
   * (one undoable step). Resolves false when it failed or was cancelled.
   */
  async function removeBackground(remover: BackgroundRemover, image: ImageBitmapSource): Promise<boolean> {
    const size = uiState.mediaSize;
    if (!size || removal) return false;
    const controller = new AbortController();
    removal = controller;
    uiState.backgroundRemoval = { status: 'running', progress: 0 };
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(image);
      const [width, height] = maskResolution(size[0], size[1]);
      const raster = await remover(
        { image: bitmap, width, height },
        {
          signal: controller.signal,
          onProgress: (value) => {
            if (removal === controller) uiState.backgroundRemoval.progress = clamp(value, 0, 1);
          }
        }
      );
      if (controller.signal.aborted) return false;
      if (raster.width !== width || raster.height !== height || raster.data.length !== width * height) {
        throw new Error('The background removal returned a mask of the wrong size');
      }
      setMaskSource(addMaskSource(raster));
      uiState.backgroundRemoval = { status: 'idle', progress: 1 };
      return true;
    } catch (e) {
      if (!controller.signal.aborted) {
        console.warn('[media-editor] background removal failed', e);
        uiState.backgroundRemoval = { status: 'failed', progress: 0 };
      }
      return false;
    } finally {
      bitmap?.close();
      if (removal === controller) removal = null;
    }
  }

  function cancelBackgroundRemoval() {
    if (!removal) return;
    removal.abort();
    removal = null;
    uiState.backgroundRemoval = { status: 'idle', progress: 0 };
  }

  /** Back to the untouched alpha, as one undoable step. */
  function resetMask() {
    const oldValue = structuredClone(toPlainMask(mediaState.mask));
    if (oldValue.source === null && !oldValue.strokes.length && !oldValue.feather) return;
    const newValue: MaskState = { source: null, feather: 0, strokes: [] };
    mediaState.mask = structuredClone(newValue);
    pushToHistory({ path: ['mask'], oldValue, newValue });
  }

  return {
    // State
    mediaSrc,
    mediaType,
    mode,
    mediaState,
    uiState,

    // Computed
    hasModifications,
    canFinish,

    // Actions
    init,
    pushToHistory,
    undo,
    redo,
    reset,

    setOutline,
    addMaskSource,
    getMaskSource,
    setMaskSource,
    setMaskFeather,
    addMaskStroke,
    addMaskOp,
    eraseSelection,
    applySelection,
    addMaskErase,
    getWorkingImage,
    setWorkingImage,
    magicErase,
    resetMask,
    removeBackground,
    cancelBackgroundRemoval
  };
});

const plainPoints = (points: readonly Vec2[]) => points.map((p) => [p[0], p[1]] as Vec2);

function toPlainOp(op: MaskOp): MaskOp {
  if (op.kind === 'polygon') return { kind: 'polygon', region: op.region, feather: op.feather, points: plainPoints(op.points) };
  if (op.kind === 'raster') {
    return { kind: 'raster', mode: op.mode, raster: op.raster, points: plainPoints(op.points) };
  }
  return { mode: op.mode, size: op.size, points: plainPoints(op.points) };
}

function toPlainMask(mask: MaskState): MaskState {
  return {
    source: mask.source,
    feather: mask.feather,
    strokes: mask.strokes.map(toPlainOp)
  };
}
