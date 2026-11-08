import { sourceToCanvas } from '../mask/maskMath';
import { fitToAspectRatio, mix } from '../geometry';
import type { Vec2 } from '../types';
import type { DrawingParameters } from './draw';

/**
 * Debug gizmo overlay: draws wireframe outlines for image boundary (green)
 * and crop boundary (red) using a 2D canvas overlay on top of the WebGPU canvas.
 */

export interface GizmoDrawInput {
  canvasSize: Vec2;
  pixelRatio: number;
  mediaSize: Vec2;
  cropOffset: { left: number; top: number; width: number; height: number };
  currentImageRatio: number;
  cropProgress?: number;
  params: DrawingParameters;
}

let gizmoCanvas: HTMLCanvasElement | null = null;
let gizmoCtx: CanvasRenderingContext2D | null = null;

export function ensureGizmoCanvas(container: HTMLElement): HTMLCanvasElement {
  if (gizmoCanvas && gizmoCanvas.parentElement === container) return gizmoCanvas;
  removeGizmoCanvas();

  gizmoCanvas = document.createElement('canvas');
  gizmoCanvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  container.appendChild(gizmoCanvas);
  gizmoCtx = gizmoCanvas.getContext('2d')!;
  return gizmoCanvas;
}

export function removeGizmoCanvas() {
  if (gizmoCanvas) {
    gizmoCanvas.remove();
    gizmoCanvas.width = gizmoCanvas.height = 0;
    gizmoCanvas = null;
    gizmoCtx = null;
  }
}

export function drawGizmos(input: GizmoDrawInput): void {
  if (!gizmoCanvas || !gizmoCtx) return;

  const { canvasSize, pixelRatio, mediaSize, cropOffset, currentImageRatio, params } = input;
  const [cw, ch] = canvasSize;
  const dpr = pixelRatio;

  // Resize gizmo canvas to match
  const targetW = Math.round(cw * dpr);
  const targetH = Math.round(ch * dpr);
  if (gizmoCanvas.width !== targetW || gizmoCanvas.height !== targetH) {
    gizmoCanvas.width = targetW;
    gizmoCanvas.height = targetH;
  }

  const ctx = gizmoCtx;
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.save();

  // Work in CSS pixel space (scale up for DPR)
  ctx.scale(dpr, dpr);

  const [imgW, imgH] = mediaSize;
  const tx = params.translation[0] / dpr, ty = params.translation[1] / dpr;
  const transform = { ...params, perspective: params.perspective };
  const screen = (point: Vec2): Vec2 => {
    const p = sourceToCanvas(point, transform, [targetW, targetH], mediaSize);
    return [p[0] / dpr, p[1] / dpr];
  };
  const corners = ([ [0, 0], [imgW, 0], [imgW, imgH], [0, imgH] ] as Vec2[]).map(screen);
  ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath();
  ctx.moveTo(...corners[0]); for (const point of corners.slice(1)) ctx.lineTo(...point); ctx.closePath(); ctx.stroke();
  const center = screen([imgW / 2, imgH / 2]);
  ctx.setLineDash([]); ctx.strokeStyle = '#00ff0088'; ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(center[0] - 12, center[1]); ctx.lineTo(center[0] + 12, center[1]);
  ctx.moveTo(center[0], center[1] - 12); ctx.lineTo(center[0], center[1] + 12); ctx.stroke();

  ctx.restore();
  ctx.save();
  ctx.scale(dpr, dpr);

  // ── Draw crop boundary (red) ─────────────────────────────────────
  const progress = input.cropProgress ?? 1;
  const cropCenterX = mix(cw / 2, cropOffset.left + cropOffset.width / 2, progress);
  const cropCenterY = mix(ch / 2, cropOffset.top + cropOffset.height / 2, progress);
  const crop = fitToAspectRatio(currentImageRatio, cropOffset.width, cropOffset.height);
  const normal = fitToAspectRatio(currentImageRatio, cw, ch);
  const cropFitW = mix(normal[0], crop[0], progress), cropFitH = mix(normal[1], crop[1], progress);

  ctx.strokeStyle = '#ff3333';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(
    cropCenterX - cropFitW / 2,
    cropCenterY - cropFitH / 2,
    cropFitW,
    cropFitH
  );

  // Crop center marker
  ctx.setLineDash([]);
  ctx.strokeStyle = '#ff333388';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cropCenterX - 8, cropCenterY);
  ctx.lineTo(cropCenterX + 8, cropCenterY);
  ctx.moveTo(cropCenterX, cropCenterY - 8);
  ctx.lineTo(cropCenterX, cropCenterY + 8);
  ctx.stroke();

  // ── Info text ────────────────────────────────────────────────────
  ctx.fillStyle = '#00ff00';
  ctx.font = '11px monospace';
  const rot = (params.rotation * 180 / Math.PI).toFixed(1);
  const sc = (params.scale / dpr).toFixed(3);
  ctx.fillText(`rot: ${rot}°  scale: ${sc}  tx: ${tx.toFixed(1)} ty: ${ty.toFixed(1)}`, 8, 14);
  ctx.fillText(`img: ${imgW}×${imgH}  flip: [${params.flip[0]},${params.flip[1]}]`, 8, 28);
  ctx.fillText(`crop: ${cropFitW.toFixed(0)}×${cropFitH.toFixed(0)}  ratio: ${currentImageRatio.toFixed(3)}`, 8, 42);
  if (params.perspective[0] !== 0 || params.perspective[1] !== 0) {
    ctx.fillText(`persp: [${params.perspective[0].toFixed(3)}, ${params.perspective[1].toFixed(3)}]`, 8, 56);
  }

  ctx.restore();
}

