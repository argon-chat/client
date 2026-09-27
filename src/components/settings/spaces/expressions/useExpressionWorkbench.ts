import { reactive, ref } from "vue";
import { ExpressionKind } from "@argon/glue";
import { canUseWorkbench } from "@/lib/expressions/workbench/entry";
import type { useExpressionUploads } from "./useExpressionUploads";

type Uploads = Pick<ReturnType<typeof useExpressionUploads>, "hold" | "release" | "replace" | "fileOf" | "kindOf">;

export interface WorkbenchSession {
  open: boolean;
  file: File | null;
  kind: ExpressionKind;
  /** The upload row being edited; null for "Create from image". */
  rowId: number | null;
}

/**
 * What the settings do with the sticker workbench: "Edit" on a waiting still image holds it and
 * opens it; saving puts the edited file in the row's place before it is checked and sent, giving up
 * puts the row back. "Create from image" opens any picture and uploads what comes out.
 */
export function useExpressionWorkbench(options: {
  uploads: Uploads;
  currentKind: () => ExpressionKind;
  /** A file made with "Create from image". */
  onCreated: (file: File) => void;
  probe?: () => Promise<boolean>;
}) {
  const available = ref(false);
  void (options.probe ?? canUseWorkbench)().then((ok) => (available.value = ok));

  const session = reactive<WorkbenchSession>({ open: false, file: null, kind: ExpressionKind.Sticker, rowId: null });

  function edit(rowId: number): boolean {
    if (!available.value || session.open) return false;
    const { uploads } = options;
    if (!uploads.hold(rowId)) return false;
    const file = uploads.fileOf(rowId);
    const kind = uploads.kindOf(rowId);
    if (!file || kind === null) {
      void uploads.release(rowId);
      return false;
    }
    Object.assign(session, { open: true, file, kind, rowId });
    return true;
  }

  function create(file: File): boolean {
    if (!available.value || session.open) return false;
    Object.assign(session, { open: true, file, kind: options.currentKind(), rowId: null });
    return true;
  }

  function done(file: File) {
    const id = session.rowId;
    session.open = false;
    session.rowId = null;
    if (id !== null) void options.uploads.replace(id, file);
    else options.onCreated(file);
  }

  function cancel() {
    const id = session.rowId;
    session.open = false;
    session.rowId = null;
    if (id !== null) void options.uploads.release(id);
  }

  return { available, session, edit, create, done, cancel };
}
