let cachedDevice: GPUDevice | undefined;

export async function initDevice(): Promise<GPUDevice> {
  if (cachedDevice && !cachedDevice.lost) return cachedDevice;

  const gpu = navigator.gpu;
  if (!gpu) throw new Error('WebGPU is not supported in this browser');

  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('Failed to obtain WebGPU adapter');

  const device = await adapter.requestDevice();

  device.lost.then((info) => {
    console.error('WebGPU device lost:', info.message);
    cachedDevice = undefined;
  });

  cachedDevice = device;
  return device;
}

export function getPreferredFormat(): GPUTextureFormat {
  return navigator.gpu.getPreferredCanvasFormat();
}
