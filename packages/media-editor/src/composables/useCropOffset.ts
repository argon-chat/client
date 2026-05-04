import { computed } from 'vue';
import { useMediaEditorContext } from './useMediaEditorContext';

export function useCropOffset() {
  const { store } = useMediaEditorContext();

  return computed(() => {
    const canvasSize = store.uiState.canvasSize;
    if (!canvasSize) return { left: 0, top: 0, width: 0, height: 0 };

    const w = canvasSize[0];
    const h = canvasSize[1];

    return {
      left: 60,
      top: 60,
      width: w - 120,
      height: h - 180
    };
  });
}
