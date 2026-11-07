import { onScopeDispose } from "vue";
import { createCameraDeviceState } from "@argon/calls";
import { logger } from "@argon/core";

export function useCameraDevices() {
  const state = createCameraDeviceState({ onError: (error) => logger.warn("[camera] Could not enumerate devices", error) });
  state.start();
  onScopeDispose(state.dispose);
  return state;
}
