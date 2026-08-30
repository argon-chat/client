/**
 * What the browser build needs from the browser.
 *
 * Argon in a tab is not a page — it holds a realtime socket, an audio graph with worklets, a WebRTC
 * session, a local database and a bucket-backed media cache. Every entry below is load-bearing: the
 * app cannot degrade around a missing one, it can only fail later and more confusingly. So the check
 * runs once before anything mounts, and a browser that comes up short is told so plainly instead of
 * being walked into a white screen twenty seconds in.
 *
 * The desktop build ships its own Chromium and never runs this.
 */

export interface CapabilityCheck {
  /** Stable id, used for the locale key of the human-readable name. */
  id: string;
  /** Short English name, shown when no translation is loaded yet (the gate runs pre-i18n). */
  label: string;
  present: () => boolean;
}

const has = (fn: () => unknown): boolean => {
  try {
    return !!fn();
  } catch {
    return false;
  }
};

export const REQUIRED_CAPABILITIES: CapabilityCheck[] = [
  { id: "websocket", label: "WebSocket", present: () => has(() => window.WebSocket) },
  {
    // The realtime transport reads frames as a stream rather than an event at a time; there is no
    // fallback path that speaks the older API.
    id: "websocket_stream",
    label: "WebSocket Streams",
    present: () => has(() => (window as any).WebSocketStream),
  },
  {
    // The overlay compositor, the video pipeline and the effects all render through WebGPU.
    id: "webgpu",
    label: "WebGPU",
    present: () => has(() => (navigator as any).gpu?.requestAdapter),
  },
  { id: "worker", label: "Web Workers", present: () => has(() => window.Worker) },
  { id: "indexeddb", label: "IndexedDB", present: () => has(() => window.indexedDB) },
  {
    id: "storage_buckets",
    label: "Storage Buckets",
    present: () => has(() => (navigator as any).storageBuckets?.open),
  },
  {
    id: "service_worker",
    label: "Service Workers",
    present: () => has(() => navigator.serviceWorker?.register),
  },
  { id: "cache_storage", label: "Cache Storage", present: () => has(() => window.caches) },
  { id: "web_crypto", label: "Web Crypto", present: () => has(() => crypto.subtle?.digest) },
  { id: "webassembly", label: "WebAssembly", present: () => has(() => WebAssembly.instantiate) },
  {
    // Asked via the node constructor rather than `AudioContext.prototype.audioWorklet`: that is an
    // accessor defined on BaseAudioContext, and reading it off the prototype object — which is not
    // an AudioContext — throws "Illegal invocation" in Chrome. The check said "unsupported" on
    // every browser that has it.
    id: "audio_worklet",
    label: "Audio Worklets",
    present: () => has(() => typeof (window as any).AudioWorkletNode === "function"),
  },
  { id: "webrtc", label: "WebRTC", present: () => has(() => window.RTCPeerConnection) },
  {
    id: "media_devices",
    label: "Microphone access",
    present: () => has(() => navigator.mediaDevices?.getUserMedia),
  },
  { id: "streams", label: "Streams", present: () => has(() => window.ReadableStream && window.WritableStream) },
  { id: "structured_clone", label: "structuredClone", present: () => has(() => window.structuredClone) },
];

/** The required capabilities this browser is missing. Empty means good to boot. */
export function missingCapabilities(): CapabilityCheck[] {
  return REQUIRED_CAPABILITIES.filter((c) => !c.present());
}

/**
 * A secure context is a precondition for most of the list above, and its absence produces the same
 * symptoms as a missing feature (`navigator.mediaDevices` simply is not there over plain http), so
 * it is worth naming separately rather than letting it masquerade as an old browser.
 */
export function isInsecureContext(): boolean {
  return typeof window !== "undefined" && !window.isSecureContext;
}
