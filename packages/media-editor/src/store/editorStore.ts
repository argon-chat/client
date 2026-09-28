import { defineStore } from 'pinia';
import { ref, reactive, computed, shallowRef, toRaw } from 'vue';
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
import type { EraserLimits, EraserSampling } from '../selection/backgroundEraser';
import { magicErase as computeMagicErase } from '../selection/magicEraser';
import { polygonArea } from '../selection/polygon';
import { rgbToHex, sampleColour } from '../selection/sample';
import { readWorkingImage, type WorkingImage } from '../selection/workingImage';

// ─── History ───────────────────────────────────────────────────────

export const REMOVE_ARRAY_ITEM = 'SSBiZWxpZXZlIEkgY2FuIGZseSwgSSBiZWxpZXZlIEkgY2FuIHRvdWNoIHRoZSBza3kh';

/** A history path starting with this segment addresses the UI state instead of the edited media. */
export const UI_PATH = '$ui';

export type HistoryPath = (string | number)[];

export type HistoryItem = {
  path: HistoryPath;
  newValue: any;
  oldValue: any;
  findBy?: { id: any };
  /** Several changes undone and redone as one step (`path` is then empty). */
  group?: HistoryItem[];
};

/**
 * One continuous edit (a drag, a slider, a typed text): whatever it changes becomes a single history
 * entry when it ends, and Esc can put it all back while it lasts.
 */
export interface Gesture {
  /** Called when the gesture is cancelled: the owner stops listening and animating. */
  onCancel?: () => void;
  readonly active: boolean;
  /** Records what the gesture changed as one entry; false when it changed nothing. */
  end(): boolean;
  /** Puts back everything the gesture changed; nothing is recorded. */
  cancel(): void;
}

export type GestureOptions = {
  /** State compared before and after: a change there is recorded (for code that mutates directly). */
  track?: HistoryPath[];
  onCancel?: () => void;
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

/** The cut-out tools' options, as Photoshop names them. */
export type CutoutOptions = {
  lassoMode: 'freehand' | 'polygon';
  /** Lasso and magnetic lasso: Feather, source pixels (0–20). */
  selectionFeather: number;
  /** Lasso and magnetic lasso: Anti-alias. */
  selectionAntiAlias: boolean;
  /** Magnetic lasso: Width, screen pixels (1–256): how far from the pointer an edge is sought. */
  edgeWidth: number;
  /** Magnetic lasso: Edge Contrast, 1–100 %: the least contrast an edge needs to attract the path. */
  edgeContrast: number;
  /** Magnetic lasso: Frequency, 0–100: how often fastening points are dropped (0: only by clicking). */
  frequency: number;
  /** Magic eraser: Tolerance, 0–255 per channel. */
  magicTolerance: number;
  magicAntiAlias: boolean;
  contiguous: boolean;
  /** Magic eraser: Opacity, 0–100 %. */
  magicOpacity: number;
  /** Magic eraser: the sampled colour's square, 1 (point), 3, 5 or 11. */
  sampleSize: number;
  /** Background eraser: diameter, screen pixels. */
  eraserSize: number;
  /** Background eraser: 0–100 %. */
  eraserHardness: number;
  /** Background eraser: distance between dabs, 1–100 % of the diameter. */
  eraserSpacing: number;
  /** Background eraser: Tolerance, 0–100 %. */
  eraserTolerance: number;
  sampling: EraserSampling;
  limits: EraserLimits;
  /** Background eraser: the Background Swatch, `#rrggbb`. */
  swatch: string;
  protectForeground: boolean;
  /** Background eraser: the protected foreground colour, `#rrggbb`. */
  foreground: string;
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
  /** Where the rotation wheel stands, CSS pixels (its fine angle). */
  rotationWheel: number;

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
  /** A gesture is open (a drag or its settling animation): undo waits for it. */
  gesture: boolean;
  /** The close confirmation is showing. */
  confirmingClose: boolean;

  debugGizmos: boolean;
  gridOverlay: 'none' | 'thirds' | 'golden' | 'diagonal';
  showBeforeAfter: boolean;

  backgroundRemoval: BackgroundRemovalState;
  /** Erase / restore brush diameter, CSS pixels. */
  maskBrushSize: number;

  cutoutTool: CutoutTool | null;
  cutoutOptions: CutoutOptions;
  selection: PendingSelection | null;
  /** Bumped by Deselect: the lasso being drawn goes too. */
  deselectSeq: number;
  /** The next click on the image picks this colour option instead of using the tool. */
  pickColour: 'swatch' | 'foreground' | null;
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

/** Photoshop's defaults. */
export function getDefaultCutoutOptions(): CutoutOptions {
  return {
    lassoMode: 'freehand',
    selectionFeather: 0,
    selectionAntiAlias: true,
    edgeWidth: 10,
    edgeContrast: 10,
    frequency: 57,
    magicTolerance: 32,
    magicAntiAlias: true,
    contiguous: true,
    magicOpacity: 100,
    sampleSize: 1,
    eraserSize: 48,
    eraserHardness: 100,
    eraserSpacing: 25,
    eraserTolerance: 50,
    sampling: 'continuous',
    limits: 'contiguous',
    swatch: '#ffffff',
    protectForeground: false,
    foreground: '#000000'
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
    rotationWheel: 0,

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
    gesture: false,
    confirmingClose: false,

    debugGizmos: false,
    gridOverlay: 'thirds',
    showBeforeAfter: false,

    backgroundRemoval: { status: 'idle', progress: 0 },
    maskBrushSize: 40,

    cutoutTool: null,
    cutoutOptions: getDefaultCutoutOptions(),
    selection: null,
    deselectSeq: 0,
    pickColour: null,
    liveWire: 'idle'
  };
}

let nextMaskSourceId = 1;

/** A deep copy of plain state (arrays, objects, numbers); typed arrays are shared, being immutable here. */
export function plainClone<T>(value: T): T {
  const v = toRaw(value) as any;
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(plainClone) as any;
  if (ArrayBuffer.isView(v)) return v as T;
  const out: any = {};
  for (const k of Object.keys(v)) out[k] = plainClone(v[k]);
  return out;
}

const samePath = (a: HistoryPath, b: HistoryPath) => a.length === b.length && a.every((s, i) => s === b[i]);
const isPrefix = (prefix: HistoryPath, path: HistoryPath) => prefix.length <= path.length && prefix.every((s, i) => s === path[i]);
const isStructural = (item: HistoryItem) => !!item.group || item.oldValue === REMOVE_ARRAY_ITEM || item.newValue === REMOVE_ARRAY_ITEM;

type GestureState = {
  tracked: { path: HistoryPath; before: unknown }[];
  items: HistoryItem[];
  handle: Gesture;
};

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

  // The history entry on top when the editor opened: anything else on top is unsaved work.
  const savedTop = shallowRef<HistoryItem | undefined>(undefined);
  const topOfHistory = () => {
    const h = mediaState.history;
    return h.length ? toRaw(h[h.length - 1]) : undefined;
  };
  const isDirty = computed(() => topOfHistory() !== savedTop.value);

  const canUndo = computed(() => mediaState.history.length > 0 && !uiState.gesture);
  const canRedo = computed(() => mediaState.redoHistory.length > 0 && !uiState.gesture);

  let gesture: GestureState | null = null;

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
    gesture = null;

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
    markSaved();
  }

  /** The current history position becomes the saved one (`isDirty` is false until it moves). */
  function markSaved() {
    savedTop.value = topOfHistory();
  }

  // ─── Paths ───────────────────────────────────────────────────────

  function rootOf(path: HistoryPath): [any, HistoryPath] {
    return path[0] === UI_PATH ? [uiState, path.slice(1)] : [mediaState, path];
  }

  function getAt(path: HistoryPath): unknown {
    let [obj, rest] = rootOf(path);
    for (const key of rest) {
      if (obj == null) return undefined;
      obj = obj[key];
    }
    return obj;
  }

  function setAt(path: HistoryPath, value: unknown) {
    const [root, rest] = rootOf(path);
    if (!rest.length) return;
    let obj = root;
    for (let i = 0; i < rest.length - 1; i++) {
      obj = obj?.[rest[i]];
      if (obj == null) return;
    }
    obj[rest[rest.length - 1]] = value;
  }

  // ─── History ─────────────────────────────────────────────────────

  function commit(item: HistoryItem) {
    mediaState.history.push(item);
    if (mediaState.redoHistory.length) {
      mediaState.redoHistory.splice(0, Infinity);
    }
  }

  /** Records a change. Inside a gesture it joins the gesture's entry (repeats on one path merge). */
  function pushToHistory(item: HistoryItem) {
    if (!gesture) {
      commit(item);
      return;
    }
    const items = gesture.items;
    const last = items[items.length - 1];
    if (last && !isStructural(last) && !isStructural(item) && samePath(last.path, item.path) && last.findBy?.id === item.findBy?.id) {
      last.newValue = item.newValue;
      return;
    }
    items.push(item);
  }

  function undo() {
    if (gesture) return;
    const item = mediaState.history.pop();
    if (!item) return;

    applyHistoryItem(item, false);
    mediaState.redoHistory.push(item);
  }

  function redo() {
    if (gesture) return;
    const item = mediaState.redoHistory.pop();
    if (!item) return;

    applyHistoryItem(item, true);
    mediaState.history.push(item);
  }

  function applyHistoryItem(item: HistoryItem, forward: boolean) {
    if (item.group) {
      const items = forward ? item.group : [...item.group].reverse();
      for (const it of items) applyHistoryItem(it, forward);
      return;
    }
    const [root, path] = rootOf([...item.path]);
    if (!path.length) return;

    let obj: any = root;
    for (let i = 0; i < path.length - 1; i++) {
      obj = obj[path[i]];
    }

    let key: any = path[path.length - 1];
    // Values go into the state as copies, so that editing the state never edits the history.
    const value = plainClone(forward ? item.newValue : item.oldValue);
    const opposite = forward ? item.oldValue : item.newValue;

    if (obj instanceof Array) {
      if (item.findBy) {
        key = obj.findIndex((v: any) => v?.id === item.findBy!.id);
      }
      if (key === -1) key = obj.length;

      if (value === REMOVE_ARRAY_ITEM) {
        obj.splice(key, 1);
      } else if (opposite === REMOVE_ARRAY_ITEM) {
        obj.splice(key, 0, value);
      } else {
        obj[key] = value;
      }
    } else {
      obj[key] = value;
    }
  }

  function finishGesture(state: GestureState): boolean {
    if (gesture !== state) return false;
    gesture = null;
    uiState.gesture = false;
    const items: HistoryItem[] = [];
    for (const it of state.items) {
      // A tracked path's before and after already cover what was pushed under it.
      if (state.tracked.some((t) => isPrefix(t.path, it.path))) continue;
      // A slider dragged back to where it started.
      if (!isStructural(it) && deepEqualApprox(it.oldValue, it.newValue)) continue;
      items.push(it);
    }
    for (const t of state.tracked) {
      const now = getAt(t.path);
      if (!deepEqualApprox(t.before, now)) items.push({ path: t.path, oldValue: t.before, newValue: plainClone(now) });
    }
    if (!items.length) return false;
    commit(items.length === 1 ? items[0] : { path: [], oldValue: null, newValue: null, group: items });
    return true;
  }

  function abortGesture(state: GestureState) {
    if (gesture !== state) return;
    gesture = null;
    uiState.gesture = false;
    for (let i = state.items.length - 1; i >= 0; i--) applyHistoryItem(state.items[i], false);
    for (const t of state.tracked) setAt(t.path, plainClone(t.before));
    state.handle.onCancel?.();
  }

  /** Opens a gesture (ending one still open). */
  function beginGesture(options: GestureOptions = {}): Gesture {
    if (gesture) finishGesture(gesture);
    const state: GestureState = { tracked: [], items: [], handle: null as unknown as Gesture };
    for (const path of options.track ?? []) state.tracked.push({ path: [...path], before: plainClone(getAt(path)) });
    state.handle = {
      onCancel: options.onCancel,
      get active() {
        return gesture === state;
      },
      end: () => finishGesture(state),
      cancel: () => abortGesture(state)
    };
    gesture = state;
    uiState.gesture = true;
    return state.handle;
  }

  /** Esc: puts back the open gesture. False when there was none. */
  function cancelGesture(): boolean {
    if (!gesture) return false;
    gesture.handle.cancel();
    return true;
  }

  /** Several changes as one entry (or as part of the open gesture). */
  function batch(mutate: () => void) {
    if (gesture) {
      mutate();
      return;
    }
    const g = beginGesture();
    try {
      mutate();
    } finally {
      g.end();
    }
  }

  /** A direct mutation of `paths`, recorded as one entry (or as part of the open gesture). */
  function change(paths: HistoryPath[], mutate: () => void) {
    if (gesture) {
      for (const path of paths) {
        if (!gesture.tracked.some((t) => samePath(t.path, path))) gesture.tracked.push({ path: [...path], before: plainClone(getAt(path)) });
      }
      mutate();
      return;
    }
    const g = beginGesture({ track: paths });
    try {
      mutate();
    } finally {
      g.end();
    }
  }

  /** Sets a value and records it (nothing when it is already that). */
  function set(path: HistoryPath, value: unknown) {
    const old = getAt(path);
    if (deepEqualApprox(old, value)) return;
    setAt(path, value);
    pushToHistory({ path: [...path], oldValue: plainClone(old), newValue: plainClone(value) });
  }

  function reset() {
    cancelBackgroundRemoval();
    gesture = null;
    Object.assign(mediaState, getDefaultEditingMediaState());
    Object.assign(uiState, getDefaultUIState());
    mediaSrc.value = '';
    mediaType.value = 'image';
    mode.value = 'full';
    maskSources.clear();
    working = null;
    markSaved();
  }

  // ─── Layers and drawings ─────────────────────────────────────────

  function addLayer(layer: EditorLayer) {
    mediaState.resizableLayers.push(layer);
    pushToHistory({ path: ['resizableLayers', mediaState.resizableLayers.length - 1], oldValue: REMOVE_ARRAY_ITEM, newValue: plainClone(layer) });
  }

  function removeLayer(id: number): boolean {
    const index = mediaState.resizableLayers.findIndex((l) => l.id === id);
    if (index < 0) return false;
    const [layer] = mediaState.resizableLayers.splice(index, 1);
    pushToHistory({ path: ['resizableLayers', index], oldValue: plainClone(layer), newValue: REMOVE_ARRAY_ITEM });
    if (uiState.selectedResizableLayer === id) uiState.selectedResizableLayer = undefined;
    return true;
  }

  function addBrushLine(line: BrushDrawnLine) {
    mediaState.brushDrawnLines.push(line);
    pushToHistory({ path: ['brushDrawnLines', mediaState.brushDrawnLines.length - 1], oldValue: REMOVE_ARRAY_ITEM, newValue: plainClone(line) });
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
  function eraseSelection(points: readonly Vec2[], region: 'inside' | 'outside', feather = 0, antiAlias = true): boolean {
    if (points.length < 3 || Math.abs(polygonArea(points)) < 1) return false;
    addMaskOp({
      kind: 'polygon',
      region,
      feather: clamp(Math.round(feather), 0, SELECTION_MAX_FEATHER),
      points: points.map((p) => [p[0], p[1]] as Vec2),
      ...(antiAlias ? {} : { antiAlias: false })
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
    const o = uiState.cutoutOptions;
    const done = eraseSelection(selection.points, eraseInside ? 'inside' : 'outside', o.selectionFeather, o.selectionAntiAlias);
    uiState.selection = null;
    return done;
  }

  /** Select All: the whole image as the pending selection. */
  function selectAll(): boolean {
    const size = uiState.mediaSize;
    if (!size) return false;
    const [w, h] = size;
    uiState.selection = { points: [[0, 0], [w, 0], [w, h], [0, h]], inverted: false };
    return true;
  }

  /** Deselect: drops the pending selection and the lasso being drawn. */
  function deselect() {
    uiState.selection = null;
    uiState.deselectSeq++;
  }

  /**
   * A computed erase in a frame of `scale` pixels per source pixel, as one undoable step; its
   * decontaminated colours, when it has any, travel with the raster.
   */
  function addMaskErase(coverage: CoverageRect & { colour?: Uint32Array | null }, scale: number): boolean {
    if (!coverage.width || !coverage.height || !(scale > 0)) return false;
    const raster = addMaskSource({ width: coverage.width, height: coverage.height, data: coverage.data, colour: coverage.colour ?? null });
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
    try {
      working = readWorkingImage(image, size);
    } catch (e) {
      console.warn('[media-editor] the image could not be read back', e);
    }
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
    const result = computeMagicErase(image, [point[0] * image.scale, point[1] * image.scale], {
      tolerance: o.magicTolerance,
      antiAlias: o.magicAntiAlias,
      contiguous: o.contiguous,
      opacity: o.magicOpacity,
      sampleSize: o.sampleSize
    });
    return result ? addMaskErase(result, image.scale) : false;
  }

  /** The image's colour at `point` (source pixels) as `#rrggbb`, or null outside it. */
  function pickColourAt(point: Vec2, size = 1): string | null {
    const image = getWorkingImage();
    if (!image) return null;
    const x = point[0] * image.scale;
    const y = point[1] * image.scale;
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
    const [r, g, b] = sampleColour(image, x, y, size);
    return rgbToHex(r, g, b);
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
    isDirty,
    canUndo,
    canRedo,

    // Actions
    init,
    markSaved,
    pushToHistory,
    undo,
    redo,
    reset,
    beginGesture,
    cancelGesture,
    batch,
    change,
    set,
    getAt,

    addLayer,
    removeLayer,
    addBrushLine,

    setOutline,
    addMaskSource,
    getMaskSource,
    setMaskSource,
    setMaskFeather,
    addMaskStroke,
    addMaskOp,
    eraseSelection,
    applySelection,
    selectAll,
    deselect,
    addMaskErase,
    getWorkingImage,
    setWorkingImage,
    magicErase,
    pickColourAt,
    resetMask,
    removeBackground,
    cancelBackgroundRemoval
  };
});

const plainPoints = (points: readonly Vec2[]) => points.map((p) => [p[0], p[1]] as Vec2);

function toPlainOp(op: MaskOp): MaskOp {
  if (op.kind === 'polygon') {
    return { kind: 'polygon', region: op.region, feather: op.feather, points: plainPoints(op.points), ...(op.antiAlias === false ? { antiAlias: false } : {}) };
  }
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
