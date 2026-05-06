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
  params: DrawingParameters;
}

let gizmoCanvas: HTMLCanvasElement | null = null;
let gizmoCtx: CanvasRenderingContext2D | null = null;

export function ensureGizmoCanvas(container: HTMLElement): HTMLCanvasElement {
  if (gizmoCanvas && gizmoCanvas.parentElement === container) return gizmoCanvas;

  gizmoCanvas = document.createElement('canvas');
  gizmoCanvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  container.appendChild(gizmoCanvas);
  gizmoCtx = gizmoCanvas.getContext('2d')!;
  return gizmoCanvas;
}

export function removeGizmoCanvas() {
  if (gizmoCanvas) {
    gizmoCanvas.remove();
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

  // Center of the viewport
  const cx = cw / 2;
  const cy = ch / 2;

  // ── Draw image boundary (green) ──────────────────────────────────
  // finalTransform.scale = userZoom * pixelRatio * snappedImageScale * toCropScale * fromCroppedScale
  // In display pixels we just divide by pixelRatio.
  const [imgW, imgH] = mediaSize;
  const displayScale = params.scale / dpr;
  const halfDisplayW = (imgW * displayScale) / 2;
  const halfDisplayH = (imgH * displayScale) / 2;

  // Translation in display pixels
  const tx = params.translation[0] / dpr;
  const ty = params.translation[1] / dpr;

  // Image corners before rotation (centered at 0,0)
  const imgCorners: Vec2[] = [
    [-halfDisplayW, -halfDisplayH],
    [ halfDisplayW, -halfDisplayH],
    [ halfDisplayW,  halfDisplayH],
    [-halfDisplayW,  halfDisplayH],
  ];

  // Apply flip + rotation + translation
  ctx.translate(cx + tx, cy + ty);
  ctx.rotate(params.rotation); // shader double-negates: writeUniforms negates, then matrix inverts
  ctx.scale(params.flip[0], params.flip[1]);

  // Image outline
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(imgCorners[0][0], imgCorners[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(imgCorners[i][0], imgCorners[i][1]);
  ctx.closePath();
  ctx.stroke();

  // Image center crosshair
  ctx.setLineDash([]);
  ctx.strokeStyle = '#00ff0088';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-12, 0); ctx.lineTo(12, 0);
  ctx.moveTo(0, -12); ctx.lineTo(0, 12);
  ctx.stroke();

  ctx.restore();
  ctx.save();
  ctx.scale(dpr, dpr);

  // ── Draw crop boundary (red) ─────────────────────────────────────
  const cropCenterX = cropOffset.left + cropOffset.width / 2;
  const cropCenterY = cropOffset.top + cropOffset.height / 2;
  const [cropFitW, cropFitH] = fitToRatio(currentImageRatio, cropOffset.width, cropOffset.height);

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

function fitToRatio(ratio: number, vw: number, vh: number): Vec2 {
  if (vw / ratio > vh) return [vh * ratio, vh];
  return [vw, vw / ratio];
}

