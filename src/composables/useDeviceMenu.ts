import { reactive, ref, watch } from "vue";
import { logger } from "@argon/core";
import { audio } from "@/lib/audio/AudioManager";

export type DeviceMenuKind = "audioinput" | "audiooutput" | "videoinput";

/**
 * A quick device switcher behind the chevron next to a call-control button.
 *
 * Microphone, speakers and camera all get the same one: the list is enumerated when the
 * menu opens (labels only populate after a permission has been granted once, and devices
 * come and go, so a list built at mount would go stale), a pick closes the menu and
 * applies the device, and a second pick while one is still applying is ignored.
 *
 * `apply` is what actually moves the audio or video — the audio manager for input and
 * output, the call store for the camera so a live track is swapped, not just the
 * preference. Its failure is logged and swallowed here: the button must come back to
 * life either way, and the manager already reports what went wrong.
 */
export function useDeviceMenu(kind: DeviceMenuKind, apply: (deviceId: string) => Promise<unknown>) {
  const devices = ref<MediaDeviceInfo[]>([]);
  const open = ref(false);
  const switching = ref(false);

  watch(open, async (isOpen) => {
    if (!isOpen) return;
    try {
      devices.value = await audio.enumerateDevicesByKind(kind);
    } catch (e) {
      logger.warn(`[controls] could not list ${kind} devices`, e);
      devices.value = [];
    }
  });

  async function pick(deviceId: string) {
    if (switching.value) return;
    switching.value = true;
    open.value = false;
    try {
      await apply(deviceId);
    } catch (e) {
      logger.warn(`[controls] switching ${kind} failed`, e);
    } finally {
      switching.value = false;
    }
  }

  // Reactive so a template can bind `menu.open` with v-model and read `menu.devices`
  // without `.value` — the refs are unwrapped through the proxy.
  return reactive({ devices, open, switching, pick });
}
