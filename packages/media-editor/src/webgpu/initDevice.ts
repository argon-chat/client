export interface DeviceLease {
  readonly device: GPUDevice;
  /** Idempotent. The final lease destroys its device and immediately drops the cache. */
  release(): void;
}

interface DeviceGeneration {
  ready: Promise<GPUDevice>;
  device?: GPUDevice;
  reservations: number;
  retired: boolean;
  destroyed: boolean;
}

let current: DeviceGeneration | undefined;

function retire(generation: DeviceGeneration): void {
  generation.retired = true;
  // An old device's loss callback or lease must never invalidate its replacement.
  if (current === generation) current = undefined;
}

function releaseReservation(generation: DeviceGeneration): void {
  generation.reservations--;
  if (generation.reservations !== 0) return;
  retire(generation);
  if (generation.device && !generation.destroyed) {
    generation.destroyed = true;
    generation.device.destroy();
  }
}

function requestGeneration(): DeviceGeneration {
  const generation: DeviceGeneration = {
    reservations: 0,
    retired: false,
    destroyed: false,
    ready: requestDevice().then(device => {
      generation.device = device;
      device.lost.then(info => {
        retire(generation);
        if (!generation.destroyed) console.error('WebGPU device lost:', info.message);
      });
      return device;
    }).catch(error => {
      retire(generation);
      throw error;
    }),
  };
  return generation;
}

/**
 * Share the pending request and live device between preview/export users. Pending
 * acquisitions reserve a reference too: the first resolved caller cannot destroy
 * a device another caller is still awaiting. Call release in every success/failure
 * cleanup path once the lease is received; no device is kept warm without leases.
 */
export async function acquireDevice(): Promise<DeviceLease> {
  const generation = current ?? (current = requestGeneration());
  generation.reservations++;
  try {
    const device = await generation.ready;
    if (generation.retired) throw new Error('WebGPU device was lost before acquisition completed');
    let released = false;
    return {
      device,
      release() {
        if (released) return;
        released = true;
        releaseReservation(generation);
      },
    };
  } catch (error) {
    releaseReservation(generation);
    throw error;
  }
}

async function requestDevice(): Promise<GPUDevice> {
  const gpu = navigator.gpu;
  if (!gpu) throw new Error('WebGPU is not supported in this browser');
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('Failed to obtain WebGPU adapter');
  return adapter.requestDevice();
}

export function getPreferredFormat(): GPUTextureFormat {
  return navigator.gpu.getPreferredCanvasFormat();
}
