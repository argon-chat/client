export { default as MediaEditor } from './components/MediaEditor.vue';
export type { MediaEditorProps, MediaEditorMode } from './components/MediaEditor.vue';
export type { MediaEditorFinalResult, MediaEditorFinalResultPayload, VideoEditSummary, VideoBitrateFn } from './finalRender/createFinalResult';
export { createFinalResult, RENDER_MAX_FPS } from './finalRender/createFinalResult';
export type { SourceVideoTransform, SourceCrop, QuarterTurn } from './finalRender/videoTransform';
export { sourceVideoTransform, hasPixelEdits } from './finalRender/videoTransform';
export type { ComposeFrame, ComposeAudio, ComposeVideoOptions, ComposedVideo } from './finalRender/composeVideo';
export { composeVideo } from './finalRender/composeVideo';
export type { EditingMediaState } from './store/editorStore';
export { QUALITY_PRESETS, resolveOutputQuality } from './constants';
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
  MaskPolygonOp,
  MaskRasterOp,
  MaskOp,
  CutoutTool,
  MaskRaster,
  BackgroundRemover,
  BackgroundRemovalInput,
  BackgroundRemovalOptions
} from './types';
export { isExpressionMode } from './types';
export { useMediaEditorStore } from './store/editorStore';
export { useVideoPlayback } from './composables/useVideoPlayback';
export type { PlatformCapabilities, VideoEditBlock } from './support';
export { checkCapabilities, videoEditBlock, MAX_EDITABLE_VIDEO_SIZE } from './support';
export {
  EXPRESSION_EXPORT_PRESETS,
  computeExpressionLayout,
  fitExpressionContent
} from './finalRender/computeExportDimensions';
export { encodeTransparentImage } from './finalRender/encodeImage';
export { featherMask, maskResolution, applyMaskToRgba, OUTLINE_MAX_RADIUS } from './mask/maskMath';
