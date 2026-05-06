import type { AdjustmentKey } from '../adjustments';
import type { Vec2 } from '../types';
import type { RenderingPayload } from './initWebGPU';
import { writeUniforms, type UniformData } from './initBuffers';

export type DrawingParameters = {
  rotation: number;
  scale: number;
  translation: Vec2;
  imageSize: Vec2;
  flip: Vec2;
  perspective: Vec2;
} & Record<AdjustmentKey, number>;

export function draw(device: GPUDevice, context: GPUCanvasContext, payload: RenderingPayload, parameters: DrawingParameters): void {
  const canvas = context.canvas as HTMLCanvasElement | OffscreenCanvas;

  const uniformData: UniformData = {
    rotation: parameters.rotation,
    scale: parameters.scale,
    flip: parameters.flip,
    imageSize: parameters.imageSize,
    resolution: [canvas.width, canvas.height],
    translation: parameters.translation,
    perspective: parameters.perspective,
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
  };

  writeUniforms(device, payload.uniformBuffer, uniformData);

  const textureView = context.getCurrentTexture().createView();

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: textureView,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store'
    }]
  });

  pass.setPipeline(payload.pipeline);
  pass.setBindGroup(0, payload.bindGroup);
  pass.setVertexBuffer(0, payload.vertexBuffer);
  pass.draw(4);
  pass.end();

  device.queue.submit([encoder.finish()]);
}
