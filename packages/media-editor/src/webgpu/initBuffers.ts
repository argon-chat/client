import type { AdjustmentKey } from '../adjustments';
import type { Vec2 } from '../types';

/**
 * Uniform buffer layout (must match WGSL Params struct):
 * offset 0:  rotation_angle (f32)
 * offset 4:  zoom (f32)
 * offset 8:  mirror (vec2f)
 * offset 16: source_dimensions (vec2f)
 * offset 24: viewport (vec2f)
 * offset 32: offset (vec2f)
 * offset 40: enhance..sharpen + padding (12 × f32)
 * Total: 88 bytes → padded to 96 (16-byte aligned)
 */
export const UNIFORM_BUFFER_SIZE = 96;

export type UniformData = {
  rotation: number;
  scale: number;
  flip: Vec2;
  imageSize: Vec2;
  resolution: Vec2;
  translation: Vec2;
} & Record<AdjustmentKey, number>;

export function createVertexBuffer(device: GPUDevice, width: number, height: number): GPUBuffer {
  // Interleaved: position (vec2f) + texCoord (vec2f) × 4 vertices (triangle-strip)
  const vertices = new Float32Array([
    // pos.x, pos.y,  tex.u, tex.v
    0,     0,       0.0, 0.0,
    width, 0,       1.0, 0.0,
    0,     height,  0.0, 1.0,
    width, height,  1.0, 1.0,
  ]);

  const buffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });

  new Float32Array(buffer.getMappedRange()).set(vertices);
  buffer.unmap();

  return buffer;
}

export function createUniformBuffer(device: GPUDevice): GPUBuffer {
  return device.createBuffer({
    size: UNIFORM_BUFFER_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
}

const uniformScratch = new Float32Array(UNIFORM_BUFFER_SIZE / 4);

export function writeUniforms(device: GPUDevice, buffer: GPUBuffer, data: UniformData): void {
  const arr = uniformScratch;

  arr[0] = -data.rotation;     // angle (negated, same as WebGL version)
  arr[1] = data.scale;
  arr[2] = data.flip[0];
  arr[3] = data.flip[1];
  arr[4] = data.imageSize[0];
  arr[5] = data.imageSize[1];
  arr[6] = data.resolution[0];
  arr[7] = data.resolution[1];
  arr[8] = data.translation[0];
  arr[9] = data.translation[1];
  arr[10] = data.enhance;
  arr[11] = data.saturation;
  arr[12] = data.brightness;
  arr[13] = data.contrast;
  arr[14] = data.warmth;
  arr[15] = data.fade;
  arr[16] = data.shadows;
  arr[17] = data.highlights;
  arr[18] = data.vignette;
  arr[19] = data.grain;
  arr[20] = data.sharpen;
  arr[21] = 0; // _pad

  device.queue.writeBuffer(buffer, 0, arr);
}
