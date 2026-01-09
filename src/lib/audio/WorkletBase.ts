import { WorkletManager } from "@argon/audio";

// Lazy-initialized worklet manager to avoid circular dependency
let _worklets: WorkletManager | null = null;
let _audioGetter: (() => any) | null = null;

// Must be called before using worklets
export function initWorklets(audioGetter: () => any) {
  _audioGetter = audioGetter;
}

function getWorklets(): WorkletManager {
  if (!_worklets) {
    if (!_audioGetter) {
      throw new Error("[WorkletBase] initWorklets() must be called before using worklets");
    }
    _worklets = new WorkletManager(_audioGetter());
  }
  return _worklets;
}

// Proxy object that lazily initializes worklets
export const worklets = new Proxy({} as WorkletManager, {
  get(_target, prop) {
    const instance = getWorklets();
    const value = (instance as any)[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  }
});
