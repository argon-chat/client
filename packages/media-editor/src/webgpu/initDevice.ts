let cachedDevice: GPUDevice | undefined;
let pendingDevice: Promise<GPUDevice> | undefined;

export async function initDevice(): Promise<GPUDevice> {
  if (cachedDevice) return cachedDevice;

  // Callers racing before the first device resolves share one request; otherwise each would get
  // its own adapter + device, and devices are never destroyed.
  if (!pendingDevice) {
    pendingDevice = requestDevice().finally(() => { pendingDevice = undefined; });
  }
  return pendingDevice;
}

async function requestDevice(): Promise<GPUDevice> {
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
