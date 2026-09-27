export { default as MediaEditor } from './components/MediaEditor.vue';
export type { MediaEditorProps, MediaEditorMode } from './components/MediaEditor.vue';
export type { MediaEditorFinalResult, MediaEditorFinalResultPayload } from './finalRender/createFinalResult';
export { createFinalResult } from './finalRender/createFinalResult';
export type { AdjustmentKey } from './adjustments';
export { ADJUSTMENTS, adjustmentKeys } from './adjustments';
export type {
  Vec2,
  MediaType,
  EditorLayer,
  TextStyle,
  FontKey,
  BrushType,
  RenderTransform,
  EditorMode,
  ExpressionEditorMode,
  ExpressionExportFormat,
  OutlineState,
  MaskState,
  MaskStroke,
  MaskRaster,
  BackgroundRemover,
  BackgroundRemovalInput,
  BackgroundRemovalOptions
} from './types';
export { isExpressionMode } from './types';
export { useMediaEditorStore } from './store/editorStore';
export { useVideoPlayback } from './composables/useVideoPlayback';
export { checkCapabilities, MAX_EDITABLE_VIDEO_SIZE } from './support';
export {
  EXPRESSION_EXPORT_PRESETS,
  computeExpressionLayout,
  fitExpressionContent
} from './finalRender/computeExportDimensions';
export { encodeTransparentImage } from './finalRender/encodeImage';
export { featherMask, maskResolution, applyMaskToRgba, OUTLINE_MAX_RADIUS } from './mask/maskMath';
