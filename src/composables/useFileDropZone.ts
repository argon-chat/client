import { computed, ref } from "vue";

/** A file manager sends many dragovers for one enter/leave pair. Only the pair tracks hover. */
export function useFileDropZone(canTakeFiles: () => boolean, acceptsOther?: (types: readonly string[]) => boolean) {
  const depth = ref(0);

  function onDragEnter(e: DragEvent) {
    if (canTakeFiles() && e.dataTransfer?.types.includes("Files")) depth.value++;
  }

  function onDragLeave() {
    depth.value = Math.max(0, depth.value - 1);
  }

  function onDragOver(e: DragEvent) {
    const dt = e.dataTransfer;
    if (!dt) return;
    const acceptsFiles = canTakeFiles() && dt.types.includes("Files");
    if (!acceptsFiles && !acceptsOther?.(dt.types)) return;
    e.preventDefault();
    dt.dropEffect = "copy";
  }

  function resetDrag() {
    depth.value = 0;
  }

  return { isDragging: computed(() => depth.value > 0), onDragEnter, onDragLeave, onDragOver, resetDrag };
}

/** A directory has a zero-byte placeholder in files. Keep real empty files and skip directories. */
export function droppedFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const items = Array.from(dt.items ?? []).filter(item => item.kind === "file");
  if (!items.length) return Array.from(dt.files);
  return items.flatMap(item => {
    if (item.webkitGetAsEntry?.()?.isDirectory) return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}
