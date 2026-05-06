import { vertexShaderSource, fragmentShaderSource } from './shaderSources';

export type PipelinePayload = {
  pipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
};

export function initPipeline(device: GPUDevice, format: GPUTextureFormat): PipelinePayload {
  const vertexModule = device.createShaderModule({ code: vertexShaderSource });
  const fragmentModule = device.createShaderModule({ code: fragmentShaderSource });

  // Log shader compilation errors
  vertexModule.getCompilationInfo().then(info => {
    for (const msg of info.messages) {
      if (msg.type === 'error') console.error('[WebGPU vertex shader]', msg.message, `line ${msg.lineNum}:${msg.linePos}`);
    }
  });
  fragmentModule.getCompilationInfo().then(info => {
    for (const msg of info.messages) {
      if (msg.type === 'error') console.error('[WebGPU fragment shader]', msg.message, `line ${msg.lineNum}:${msg.linePos}`);
    }
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' }
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float' }
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'filtering' }
      }
    ]
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout]
  });

  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: vertexModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 4 * 4, // 4 floats * 4 bytes (pos.xy + tex.xy interleaved)
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },   // position
            { shaderLocation: 1, offset: 8, format: 'float32x2' }    // texCoord
          ]
        }
      ]
    },
    fragment: {
      module: fragmentModule,
      entryPoint: 'fs_main',
      targets: [{ format }]
    },
    primitive: {
      topology: 'triangle-strip',
      stripIndexFormat: undefined
    }
  });

  return { pipeline, bindGroupLayout };
}
