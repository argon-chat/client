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
 * offset 40: enhance..sharpen (11 × f32)
 * offset 84: perspective_x, perspective_y (2 × f32)
 * offset 92: tilt_shift, chromatic, fisheye, glitch, motion_blur (5 × f32)
 * offset 112: curves_r_shadows, curves_r_highlights (2 × f32)
 * offset 120: curves_g_shadows, curves_g_highlights (2 × f32)
 * offset 128: curves_b_shadows, curves_b_highlights (2 × f32)
 * offset 136: selective_hue, selective_range, selective_shift, selective_sat (4 × f32)
 * offset 152: selective_luma (f32)
 * offset 156-192: _padding (9 × f32 to reach 192)
 * Total: 192 bytes (16-byte aligned)
 */
export const UNIFORM_BUFFER_SIZE = 192;
// TODO port uniform data to pewpew engine uniform webgpu wrappers
export type UniformData = {
  rotation: number;
  scale: number;
  flip: Vec2;
  imageSize: Vec2;
  resolution: Vec2;
  translation: Vec2;
  perspective: Vec2;
  curves: { r: Vec2; g: Vec2; b: Vec2 };
  selective: { hue: number; range: number; shift: number; sat: number; luma: number };
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

  arr[0] = -data.rotation;     // angle
  arr[1] = data.scale;
  arr[2] = data.flip[0];
  arr[3] = data.flip[1];
  arr[4] = data.imageSize[0];
  arr[5] = data.imageSize[1];
  arr[6] = data.resolution[0];
  arr[7] = data.resolution[1];
  arr[8] = data.translation[0];
  arr[9] = data.translation[1];
  arr[10] = data.enhance || 0;
  arr[11] = data.saturation || 0;
  arr[12] = data.brightness || 0;
  arr[13] = data.contrast || 0;
  arr[14] = data.warmth || 0;
  arr[15] = data.fade || 0;
  arr[16] = data.shadows || 0;
  arr[17] = data.highlights || 0;
  arr[18] = data.vignette || 0;
  arr[19] = data.grain || 0;
  arr[20] = data.sharpen || 0;
  arr[21] = data.perspective[0];
  arr[22] = data.perspective[1];
  arr[23] = data.tiltShift || 0;
  arr[24] = data.chromatic || 0;
  arr[25] = data.fisheye || 0;
  arr[26] = data.glitch || 0;
  arr[27] = data.motionBlur || 0;
  // Curves: per-channel shadow/highlight lift
  const curves = data.curves || { r: [0, 0], g: [0, 0], b: [0, 0] };
  arr[28] = curves.r[0];
  arr[29] = curves.r[1];
  arr[30] = curves.g[0];
  arr[31] = curves.g[1];
  arr[32] = curves.b[0];
  arr[33] = curves.b[1];
  // Selective color
  const sel = data.selective || { hue: 0, range: 0, shift: 0, sat: 0, luma: 0 };
  arr[34] = sel.hue;
  arr[35] = sel.range;
  arr[36] = sel.shift;
  arr[37] = sel.sat;
  arr[38] = sel.luma;
  // indices 39-47 are padding
  arr[39] = 0;
  arr[40] = 0;
  arr[41] = 0;
  arr[42] = 0;
  arr[43] = 0;
  arr[44] = 0;
  arr[45] = 0;
  arr[46] = 0;
  arr[47] = 0;

  device.queue.writeBuffer(buffer, 0, arr);
}
