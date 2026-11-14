import { computed, ref } from "vue";

type CameraMediaDevices = Pick<MediaDevices, "enumerateDevices"> & Partial<Pick<MediaDevices, "addEventListener" | "removeEventListener">> & {
  /** Native hardware enumeration does not depend on a camera permission grant. */
  __skVideoEnumerationAuthoritative?: boolean;
};

export function createCameraDeviceState(options: {
  mediaDevices?: () => CameraMediaDevices | undefined;
  permissionGranted?: () => Promise<boolean>;
  onError?: (error: unknown) => void;
} = {}) {
  const devices = ref<MediaDeviceInfo[]>([]);
  const loaded = ref(false);
  const confirmed = ref(false);
  const error = ref<unknown>(null);
  const unavailable = computed(() => loaded.value && confirmed.value && !error.value && devices.value.length === 0);
  const getDevices: () => CameraMediaDevices | undefined = options.mediaDevices || (() => typeof navigator === "undefined" ? undefined : navigator.mediaDevices);
  let subscribed: CameraMediaDevices | undefined;
  let disposed = false;
  let pending: Promise<MediaDeviceInfo[] | null> | null = null;

  async function browserGrant(): Promise<boolean> {
    if (options.permissionGranted) return options.permissionGranted();
    try { return (await navigator.permissions.query({ name: "camera" as PermissionName })).state === "granted"; }
    catch { return false; }
  }

  function refresh(): Promise<MediaDeviceInfo[] | null> {
    if (pending) return pending;
    pending = (async () => {
      const md = getDevices();
      if (!md || typeof md.enumerateDevices !== "function") { confirmed.value = false; return null; }
      try {
        const list = (await md.enumerateDevices()).filter((device) => device.kind === "videoinput");
        const complete = md.__skVideoEnumerationAuthoritative === true || list.some((device) => !!device.deviceId) || await browserGrant();
        if (disposed) return null;
        devices.value = list;
        loaded.value = true;
        confirmed.value = complete;
        error.value = null;
        return list;
      } catch (e) {
        if (!disposed) {
          error.value = e;
          confirmed.value = false;
          options.onError?.(e);
        }
        return null;
      }
    })().finally(() => { pending = null; });
    return pending;
  }

  function resolveDevice(preferred?: string): string | undefined {
    if (!preferred || preferred === "default") return undefined;
    if (!confirmed.value || error.value || devices.value.some((device) => device.deviceId === preferred)) return preferred;
    return devices.value.find((device) => !!device.deviceId)?.deviceId;
  }

  const changed = () => { void refresh(); };
  function start() {
    if (disposed || subscribed) return;
    subscribed = getDevices();
    subscribed?.addEventListener?.("devicechange", changed);
    void refresh();
  }
  function dispose() {
    disposed = true;
    subscribed?.removeEventListener?.("devicechange", changed);
    subscribed = undefined;
  }

  return { devices, loaded, confirmed, error, unavailable, refresh, resolveDevice, start, dispose };
}
