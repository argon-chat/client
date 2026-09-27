import { loadExpressionBytes } from "./files";
import { getLottiePool, type LottiePlayerHandle, type LottiePool } from "./lottie/LottiePool";

/** Default group of custom emoji players, shared by every overlay on screen. */
export const CUSTOM_EMOJI_GROUP = "emoji";

export interface CustomEmojiParams {
  fileId: string;
  /** CSS pixels. */
  size: number;
  /** Where the bytes are fetched from, and the URL tried if that one cannot be fetched at all. */
  url: string;
  fallbackUrl?: string | null;
  group?: string;
}

export interface CustomEmojiLease {
  readonly key: string;
  /** The latest frame, borrowed: draw it now, don't keep it (it is closed when the next arrives). */
  frame(): ImageBitmap | null;
  readonly failed: boolean;
  setVisible(visible: boolean): void;
  release(): void;
}

interface Entry {
  key: string;
  handle: LottiePlayerHandle;
  frame: ImageBitmap | null;
  failed: boolean;
  leases: Set<Lease>;
}

interface Lease extends CustomEmojiLease {
  visible: boolean;
  onFrame: () => void;
}

const entries = new Map<string, Entry>();
let pool: LottiePool | null = null;

/** Tests: route the registry to another pool. */
export function setCustomEmojiPool(next: LottiePool | null): void {
  pool = next;
}

export function customEmojiKey(fileId: string, size: number): string {
  return `${fileId}-${Math.round(size)}`;
}

function updateVisibility(entry: Entry) {
  let visible = false;
  for (const lease of entry.leases) if ((visible = lease.visible)) break;
  entry.handle.setVisible(visible);
}

/**
 * One Lottie player per fileId and size, shared by every overlay on screen: a hundred copies of one
 * emoji cost one render per frame. It plays while any of its placeholders is visible; `onFrame`
 * runs for every lease when a frame arrives so each overlay can schedule a redraw.
 */
export function acquireCustomEmoji(params: CustomEmojiParams, onFrame: () => void): CustomEmojiLease {
  const key = customEmojiKey(params.fileId, params.size);
  let entry = entries.get(key);
  if (!entry) {
    const created: Entry = { key, handle: null!, frame: null, failed: false, leases: new Set() };
    created.handle = (pool ?? getLottiePool()).createPlayer({
      fileId: params.fileId,
      load: () => loadExpressionBytes(params.fileId, params.url, params.fallbackUrl),
      width: params.size,
      height: params.size,
      loop: true,
      group: params.group ?? CUSTOM_EMOJI_GROUP,
      observe: false,
      initiallyVisible: false,
      onFrame: (bitmap) => {
        created.frame = bitmap;
        for (const lease of created.leases) lease.onFrame();
      },
      onError: () => {
        created.failed = true;
        created.frame = null;
        for (const lease of created.leases) lease.onFrame();
      },
    });
    entries.set(key, created);
    entry = created;
  }

  const owner = entry;
  const lease: Lease = {
    key,
    visible: false,
    onFrame,
    frame: () => (owner.failed ? null : owner.frame),
    get failed() {
      return owner.failed;
    },
    setVisible(visible) {
      if (lease.visible === visible || !owner.leases.has(lease)) return;
      lease.visible = visible;
      updateVisibility(owner);
    },
    release() {
      if (!owner.leases.delete(lease)) return;
      if (owner.leases.size) {
        updateVisibility(owner);
        return;
      }
      owner.frame = null;
      owner.handle.destroy();
      if (entries.get(key) === owner) entries.delete(key);
    },
  };
  entry.leases.add(lease);
  return lease;
}

/** Players alive right now (one per fileId and size). */
export function customEmojiPlayerCount(): number {
  return entries.size;
}
