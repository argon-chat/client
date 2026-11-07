import { shallowRef } from "vue";
import type { VoiceMember, OverlayChatMessage, OverlayNotification, OverlayHudConfig } from "@/lib/overlay/types";
import type { DrawPacket } from "@/lib/screencast-draw/types";
import type { MonitorTarget } from "./host";
import { shell } from "./host";
import { appWindow } from "@/lib/vn/window";

export const hudVoice = shallowRef<{ inVoice: boolean; members: VoiceMember[] }>({ inVoice: false, members: [] });
export const hudChat = shallowRef<OverlayChatMessage[]>([]);
export const hudConfig = shallowRef<OverlayHudConfig | null>(null);
const notifications = new Set<(value: OverlayNotification) => void>();
const strokes = new Set<(value: DrawPacket) => void>();
export function setHudVoice(value: typeof hudVoice.value): void { hudVoice.value = value; }
export function setHudChat(value: OverlayChatMessage[]): void { hudChat.value = value; }
export function pushHudNotification(value: OverlayNotification): void {
  for (const fn of notifications) fn(value);
}
export function onHudNotification(fn: (value: OverlayNotification) => void): () => void {
  notifications.add(fn); return () => { notifications.delete(fn); };
}
export const drawingTarget = shallowRef<MonitorTarget | null>(null);
let drawingEpoch = 0;
let drawingTimer: ReturnType<typeof setInterval> | null = null;
export function stopNativeDrawing(): void {
  drawingEpoch++;
  if (drawingTimer) clearInterval(drawingTimer);
  drawingTimer = null;
  drawingTarget.value = null;
}
export function nativeDrawingAvailable(): boolean { return typeof shell?.capture?.target === "function"; }
export function startNativeDrawing(sourceId: string | null): void {
  stopNativeDrawing();
  if (!sourceId || !nativeDrawingAvailable()) return;
  const epoch = drawingEpoch;
  const refresh = () => {
    if (epoch !== drawingEpoch) return;
    try {
      drawingTarget.value = shell.capture.target(sourceId);
      if (!drawingTarget.value) stopNativeDrawing();
    } catch (error) {
      stopNativeDrawing();
      console.warn("[draw] capture target is unavailable", error);
    }
  };
  refresh();
  if (drawingTarget.value) drawingTimer = setInterval(refresh, 350);
}
export function applyNativeStroke(packet: DrawPacket): void {
  if (drawingTarget.value) for (const fn of strokes) fn(packet);
}
export function onNativeStroke(fn: (value: DrawPacket) => void): () => void {
  strokes.add(fn); return () => { strokes.delete(fn); };
}
/** SDK window bounds use the main window's DIP space, including on other monitors. */
export function targetBounds(target: MonitorTarget) {
  const mainScale = appWindow?.scaleFactor;
  const scale = typeof mainScale === "number" && Number.isFinite(mainScale) && mainScale > 0 ? mainScale : 1;
  return { x: target.x / scale, y: target.y / scale, width: target.w / scale, height: target.h / scale };
}
