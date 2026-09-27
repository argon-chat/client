import type { AdjustmentKey } from '../adjustments';
import type { Vec2 } from '../types';
import type { RenderingPayload } from './initWebGPU';
import { writeUniforms, type UniformData } from './initBuffers';
import type { OutlineDrawParams } from './stickerCompositor';

export type DrawingParameters = {
  rotation: number;
  scale: number;
  translation: Vec2;
  imageSize: Vec2;
  flip: Vec2;
  perspective: Vec2;
  curves: { r: Vec2; g: Vec2; b: Vec2 };
  selective: { hue: number; range: number; shift: number; sat: number; luma: number };
} & Record<AdjustmentKey, number>;

/**
 * `outline` applies to a transparent payload only (radius in canvas pixels): the image then goes to
 * the compositor's texture and the compositor fills the canvas.
 */
export function draw(device: GPUDevice, context: GPUCanvasContext, payload: RenderingPayload, parameters: DrawingParameters, outline: OutlineDrawParams | null = null): void {
  const canvas = context.canvas as HTMLCanvasElement | OffscreenCanvas;

  const uniformData: UniformData = {
    rotation: parameters.rotation,
    scale: parameters.scale,
    flip: parameters.flip,
    imageSize: parameters.imageSize,
    resolution: [canvas.width, canvas.height],
    translation: parameters.translation,
    perspective: parameters.perspective,
    curves: parameters.curves,
    selective: parameters.selective,
    enhance: parameters.enhance,
    saturation: parameters.saturation,
    brightness: parameters.brightness,
    contrast: parameters.contrast,
    warmth: parameters.warmth,
    fade: parameters.fade,
    shadows: parameters.shadows,
    highlights: parameters.highlights,
    vignette: parameters.vignette,
    grain: parameters.grain,
    sharpen: parameters.sharpen,
    tiltShift: parameters.tiltShift,
    chromatic: parameters.chromatic,
    fisheye: parameters.fisheye,
    glitch: parameters.glitch,
    motionBlur: parameters.motionBlur,
  };

  writeUniforms(device, payload.uniformBuffer, uniformData);

  const textureView = context.getCurrentTexture().createView();
  const compositor = payload.compositor;
  if (compositor) compositor.ensureSize(canvas.width, canvas.height);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: compositor ? compositor.imageView : textureView,
      clearValue: { r: 0, g: 0, b: 0, a: compositor ? 0 : 1 },
      loadOp: 'clear',
      storeOp: 'store'
    }]
  });

  pass.setPipeline(payload.pipeline);
  pass.setBindGroup(0, payload.bindGroup);
  pass.setVertexBuffer(0, payload.vertexBuffer);
  pass.draw(4);
  pass.end();

  if (compositor) compositor.encode(encoder, textureView, outline);

  device.queue.submit([encoder.finish()]);
}
