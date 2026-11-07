import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeDevice() {
  const lost = deferred<GPUDeviceLostInfo>();
  const destroy = vi.fn();
  return { device: { lost: lost.promise, destroy } as unknown as GPUDevice, lost, destroy };
}

function installGPU(requestDevice: () => Promise<GPUDevice>) {
  const adapter = { requestDevice: vi.fn(requestDevice) };
  const gpu = {
    requestAdapter: vi.fn(async () => adapter),
    getPreferredCanvasFormat: vi.fn(() => "bgra8unorm" as GPUTextureFormat),
  };
  vi.stubGlobal("navigator", { gpu });
  return { adapter, gpu };
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("shared WebGPU device leases", () => {
  test("overlapping preview/export leases share the device until the final release", async () => {
    const a = fakeDevice(), b = fakeDevice();
    const { adapter, gpu } = installGPU(vi.fn().mockResolvedValueOnce(a.device).mockResolvedValueOnce(b.device));
    const { acquireDevice, getPreferredFormat } = await import("../src/webgpu/initDevice");
    const preview = await acquireDevice(), exporter = await acquireDevice();
    expect(preview.device).toBe(a.device);
    expect(exporter.device).toBe(a.device);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(1);
    expect(gpu.requestAdapter).toHaveBeenCalledWith({ powerPreference: "high-performance" });
    expect(getPreferredFormat()).toBe("bgra8unorm");
    preview.release();
    preview.release();
    expect(a.destroy).not.toHaveBeenCalled();
    exporter.release();
    exporter.release();
    expect(a.destroy).toHaveBeenCalledTimes(1);
    const next = await acquireDevice();
    expect(next.device).toBe(b.device);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(2);
    next.release();
    expect(b.destroy).toHaveBeenCalledTimes(1);
  });

  test("concurrent first acquisitions share one pending request and reserve both leases", async () => {
    const a = fakeDevice(), result = deferred<GPUDevice>();
    const { adapter, gpu } = installGPU(() => result.promise);
    const { acquireDevice } = await import("../src/webgpu/initDevice");
    const previewReady = acquireDevice();
    const exportReady = acquireDevice();
    await Promise.resolve();
    expect(gpu.requestAdapter).toHaveBeenCalledTimes(1);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(1);
    result.resolve(a.device);
    const preview = await previewReady;
    preview.release(); // The other acquisition is reserved even before its caller continues.
    expect(a.destroy).not.toHaveBeenCalled();
    const exporter = await exportReady;
    expect(exporter.device).toBe(a.device);
    exporter.release();
    expect(a.destroy).toHaveBeenCalledTimes(1);
  });

  test("a last release racing a new acquisition retains the pending new lease", async () => {
    const a = fakeDevice();
    const { adapter } = installGPU(async () => a.device);
    const { acquireDevice } = await import("../src/webgpu/initDevice");
    const preview = await acquireDevice();
    const exportReady = acquireDevice();
    preview.release();
    expect(a.destroy).not.toHaveBeenCalled();
    const exporter = await exportReady;
    expect(exporter.device).toBe(a.device);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(1);
    exporter.release();
    expect(a.destroy).toHaveBeenCalledTimes(1);
  });

  test("a destroyed old device's late loss callback cannot evict a replacement", async () => {
    const a = fakeDevice(), b = fakeDevice();
    const { adapter } = installGPU(vi.fn().mockResolvedValueOnce(a.device).mockResolvedValueOnce(b.device));
    const { acquireDevice } = await import("../src/webgpu/initDevice");
    const old = await acquireDevice();
    old.release();
    const next = await acquireDevice();
    a.lost.resolve({ reason: "destroyed", message: "old device destroyed" });
    await a.device.lost;
    const sharedNext = await acquireDevice();
    expect(sharedNext.device).toBe(b.device);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(2);
    expect(console.error).not.toHaveBeenCalled();
    next.release();
    expect(b.destroy).not.toHaveBeenCalled();
    sharedNext.release();
    expect(b.destroy).toHaveBeenCalledTimes(1);
  });

  test("loss retires an active generation without old releases touching the replacement", async () => {
    const a = fakeDevice(), b = fakeDevice();
    const { adapter } = installGPU(vi.fn().mockResolvedValueOnce(a.device).mockResolvedValueOnce(b.device));
    const { acquireDevice } = await import("../src/webgpu/initDevice");
    const old = await acquireDevice();
    a.lost.resolve({ reason: "unknown", message: "device removed" });
    await a.device.lost;
    const next = await acquireDevice();
    old.release();
    old.release();
    expect(a.destroy).toHaveBeenCalledTimes(1);
    expect(b.destroy).not.toHaveBeenCalled();
    const sharedNext = await acquireDevice();
    expect(sharedNext.device).toBe(b.device);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(2);
    next.release(); sharedNext.release();
    expect(b.destroy).toHaveBeenCalledTimes(1);
  });

  test("an acquisition overtaken by loss rejects and releases its reservation", async () => {
    const a = fakeDevice(), b = fakeDevice();
    installGPU(vi.fn().mockResolvedValueOnce(a.device).mockResolvedValueOnce(b.device));
    const { acquireDevice } = await import("../src/webgpu/initDevice");
    const old = await acquireDevice();
    a.lost.resolve({ reason: "unknown", message: "device removed" });
    const raced = acquireDevice(); // Loss callback runs before this acquisition's await resumes.
    await expect(raced).rejects.toThrow("lost before acquisition completed");
    expect(a.destroy).not.toHaveBeenCalled();
    old.release();
    expect(a.destroy).toHaveBeenCalledTimes(1);
    const next = await acquireDevice();
    expect(next.device).toBe(b.device);
    next.release();
  });

  test("a device already lost when its request resolves is destroyed without handing out a lease", async () => {
    const a = fakeDevice(), b = fakeDevice();
    a.lost.resolve({ reason: "unknown", message: "lost during initialization" });
    installGPU(vi.fn().mockResolvedValueOnce(a.device).mockResolvedValueOnce(b.device));
    const { acquireDevice } = await import("../src/webgpu/initDevice");
    await expect(acquireDevice()).rejects.toThrow("lost before acquisition completed");
    expect(a.destroy).toHaveBeenCalledTimes(1);
    const retry = await acquireDevice();
    expect(retry.device).toBe(b.device);
    retry.release();
  });

  test("failed shared requests reject every waiter and allow a fresh request", async () => {
    const a = fakeDevice(), failed = deferred<GPUDevice>();
    const request = vi.fn().mockReturnValueOnce(failed.promise).mockResolvedValueOnce(a.device);
    const { adapter } = installGPU(request);
    const { acquireDevice } = await import("../src/webgpu/initDevice");
    const first = acquireDevice(), second = acquireDevice();
    const settled = Promise.allSettled([first, second]);
    failed.reject(new Error("adapter initialization failed"));
    expect((await settled).map(result => result.status)).toEqual(["rejected", "rejected"]);
    const retry = await acquireDevice();
    expect(retry.device).toBe(a.device);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(2);
    retry.release();
    expect(a.destroy).toHaveBeenCalledTimes(1);
  });

  test("missing WebGPU and unavailable adapters do not poison later acquisitions", async () => {
    vi.stubGlobal("navigator", {});
    const { acquireDevice } = await import("../src/webgpu/initDevice");
    await expect(acquireDevice()).rejects.toThrow("WebGPU is not supported");
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => null } });
    await expect(acquireDevice()).rejects.toThrow("Failed to obtain WebGPU adapter");
    const a = fakeDevice();
    installGPU(async () => a.device);
    const retry = await acquireDevice();
    expect(retry.device).toBe(a.device);
    retry.release();
    expect(a.destroy).toHaveBeenCalledTimes(1);
  });
});
