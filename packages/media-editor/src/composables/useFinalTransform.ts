import { watch, computed } from 'vue';
import { useMediaEditorContext } from './useMediaEditorContext';
import { useCropOffset } from './useCropOffset';
import { fitToAspectRatio, computeViewportScaleRatio, mix, mixArray } from '../geometry';
import { tween } from '../animation';
import type { Vec2 } from '../types';

export function useFinalTransform() {
  const { store } = useMediaEditorContext();
  const cropOffset = useCropOffset();

  const isCropping = computed(() => store.uiState.currentTab === 'crop');

  // Animate crop tab transition
  let cancelCropAnim: (() => void) | null = null;
  watch(isCropping, (cropping) => {
    cancelCropAnim?.();
    const from = store.uiState.cropTabAnimationProgress;
    const to = cropping ? 1 : 0;
    store.uiState.isMoving = true;
    const handle = tween({
      from, to, duration: 200,
      onUpdate: (v: number) => { store.uiState.cropTabAnimationProgress = v; },
      onComplete: () => { store.uiState.isMoving = false; }
    });
    cancelCropAnim = handle.cancel;
  });

  const additionalImageScales = computed(() => {
    const payload = store.uiState.renderingPayload;
    if (!payload || !store.uiState.canvasSize) return null;

    const [w, h] = store.uiState.canvasSize;
    const co = cropOffset.value;
    const imageRatio = payload.media.width / payload.media.height;

    const toCropScale = computeViewportScaleRatio(imageRatio, co.width, co.height, w, h);
    const fromCroppedScale =
      1 / computeViewportScaleRatio(store.mediaState.currentImageRatio, co.width, co.height, w, h);
    const snappedImageScale = Math.min(w / payload.media.width, h / payload.media.height);

    return { toCropScale, fromCroppedScale, snappedImageScale };
  });

  const cropTranslation = computed(() => {
    if (!store.uiState.canvasSize || !additionalImageScales.value) return [0, 0] as Vec2;
    const [, h] = store.uiState.canvasSize;
    const co = cropOffset.value;
    const { fromCroppedScale } = additionalImageScales.value;

    return mixArray(
      store.mediaState.translation.map((x) => x * fromCroppedScale - x),
      [0, co.top + co.height / 2 - h / 2],
      store.uiState.cropTabAnimationProgress
    ) as Vec2;
  });

  // Main effect: update finalTransform on the store
  watch(
    [
      () => store.uiState.renderingPayload,
      () => store.uiState.canvasSize,
      () => store.uiState.pixelRatio,
      () => store.uiState.cropTabAnimationProgress,
      () => store.mediaState.scale,
      () => store.mediaState.rotation,
      () => store.mediaState.translation,
      () => store.mediaState.flip,
      () => store.mediaState.currentImageRatio
    ],
    () => {
      const payload = store.uiState.renderingPayload;
      if (!payload || !additionalImageScales.value) return;

      let { fromCroppedScale, toCropScale, snappedImageScale } = additionalImageScales.value;
      toCropScale *= mix(fromCroppedScale, 1, store.uiState.cropTabAnimationProgress);

      const ct = cropTranslation.value;

      store.uiState.finalTransform = {
        flip: store.mediaState.flip as Vec2,
        rotation: store.mediaState.rotation,
        scale: store.mediaState.scale * store.uiState.pixelRatio * snappedImageScale * toCropScale,
        translation: [
          (ct[0] + store.mediaState.translation[0]) * store.uiState.pixelRatio,
          (ct[1] + store.mediaState.translation[1]) * store.uiState.pixelRatio
        ]
      };
    },
    { deep: true, immediate: true }
  );
}
