import { defineStore } from 'pinia';
import { ref, reactive, computed, watch, shallowRef } from 'vue';
import { adjustmentsConfig, type AdjustmentKey } from '../adjustments';
import type {
  Vec2,
  MediaType,
  EditorLayer,
  TextStyle,
  BrushType,
  RenderTransform
} from '../types';
import type { BrushDrawnLine } from '../canvas/brushPainter';
import type { RenderingPayload } from '../webgpu/initWebGPU';
import { DEFAULT_TEXT_STYLE, DEFAULT_BRUSH } from '../constants';
import { deepEqualApprox, omitKeys } from '../comparison';

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
  currentImageRatio: number;

  currentVideoTime: number;
  videoCropStart: number;
  videoCropLength: number;
  videoThumbnailPosition: number;
  videoMuted: boolean;
  videoQuality: number;

  adjustments: Record<AdjustmentKey, number>;

  resizableLayers: EditorLayer[];
  brushDrawnLines: BrushDrawnLine[];

  history: HistoryItem[];
  redoHistory: HistoryItem[];
}

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
}

// ─── Defaults ──────────────────────────────────────────────────────

function getDefaultEditingMediaState(): EditingMediaState {
  return {
    scale: 1,
    rotation: 0,
    translation: [0, 0],
    flip: [1, 1],
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

    resizableLayers: [],
    brushDrawnLines: [],

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

    currentBrush: structuredClone(DEFAULT_BRUSH),
    previewBrushSize: undefined,

    resizeHandlesContainer: undefined,

    isAdjusting: false,
    isMoving: false,
    isPlaying: false
  };
}

// ─── Store ─────────────────────────────────────────────────────────

export const useMediaEditorStore = defineStore('media-editor', () => {
  // Core props
  const mediaSrc = ref('');
  const mediaType = ref<MediaType>('image');
  const mode = ref<'full' | 'avatar'>('full');

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

  const canFinish = computed(() => {
    return mode.value === 'avatar' || hasModifications.value;
  });

  // ─── Actions ─────────────────────────────────────────────────────

  function init(options: {
    src: string;
    type: MediaType;
    mode?: 'full' | 'avatar';
    initialState?: EditingMediaState;
    initialTab?: string;
  }) {
    mediaSrc.value = options.src;
    mediaType.value = options.type;
    mode.value = options.mode ?? 'full';

    const newState = options.initialState
      ? structuredClone(options.initialState)
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
    Object.assign(mediaState, getDefaultEditingMediaState());
    Object.assign(uiState, getDefaultUIState());
    mediaSrc.value = '';
    mediaType.value = 'image';
    mode.value = 'full';
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
    reset
  };
});
