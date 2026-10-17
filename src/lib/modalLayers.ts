import {
  onBeforeUnmount,
  onMounted,
  watch,
} from "vue";

interface EscapeLayer {
  readonly isOpen: () => boolean;
  readonly dismiss: () => void;
}

/** Ordered by when each layer last opened, so the last open one is the one on top. */
const layers: EscapeLayer[] = [];

function topOpenLayer(): EscapeLayer | null {
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index];

    if (layer.isOpen()) {
      return layer;
    }
  }

  return null;
}

/**
 * Whether a layer registered through `useEscapeDismiss` is open, for window-level Escape handlers that
 * must not close their window underneath it. Dialogs that never registered keep the key's old meaning.
 */
export function isEscapeLayerOpen(): boolean {
  return topOpenLayer() !== null;
}

/**
 * The settings windows are vaul drawers with `dismissible: false`, whose own Escape handler calls
 * `preventDefault()` first, and reka only dismisses when the event is not prevented. A capture
 * listener on `window` is the one position ahead of both; it stops the event so one press closes
 * exactly one thing.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) {
    return;
  }

  const top = topOpenLayer();

  if (top === null) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  top.dismiss();
}

function remove(layer: EscapeLayer): void {
  const index = layers.indexOf(layer);

  if (index !== -1) {
    layers.splice(index, 1);
  }
}

function register(layer: EscapeLayer): void {
  if (layers.length === 0) {
    window.addEventListener("keydown", onKeyDown, true);
  }

  layers.push(layer);
}

function unregister(layer: EscapeLayer): void {
  remove(layer);

  if (layers.length === 0) {
    window.removeEventListener("keydown", onKeyDown, true);
  }
}

function raise(layer: EscapeLayer): void {
  if (!layers.includes(layer)) {
    return;
  }

  remove(layer);
  layers.push(layer);
}

/**
 * Closes a dialog on Escape ahead of everything else that wants the key. Only the topmost open layer
 * takes a press, and a press something earlier already claimed is left alone.
 */
export function useEscapeDismiss(isOpen: () => boolean, dismiss: () => void): void {
  const layer: EscapeLayer = { isOpen, dismiss };

  watch(isOpen, open => {
    if (open) {
      raise(layer);
    }
  });

  onMounted(() => {
    register(layer);
  });

  onBeforeUnmount(() => {
    unregister(layer);
  });
}
