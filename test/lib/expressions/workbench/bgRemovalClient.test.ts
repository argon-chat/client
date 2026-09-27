/**
 * The main-thread side of background removal, over a stand-in worker: requests carry the image
 * (transferred) and the mask size, progress and results find their request, and cancelling
 * stops the worker instead of waiting for a run onnxruntime cannot interrupt.
 */

import { describe, test, expect, vi } from "vitest";
import { createBackgroundRemovalClient } from "@/lib/expressions/workbench/bgRemovalClient";
import type { BgRemovalEvent, BgRemovalRequest } from "@/lib/expressions/workbench/bgRemovalProtocol";

class FakeWorker {
  onmessage: ((e: MessageEvent<BgRemovalEvent>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: { data: BgRemovalRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  postMessage(data: BgRemovalRequest, transfer: Transferable[]) {
    this.posted.push({ data, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  emit(event: BgRemovalEvent) {
    this.onmessage?.({ data: event } as MessageEvent<BgRemovalEvent>);
  }
}

const bitmap = () => ({ width: 10, height: 10, close: vi.fn() }) as unknown as ImageBitmap;

function setup() {
  const workers: FakeWorker[] = [];
  const client = createBackgroundRemovalClient({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    },
  });
  return { client, workers };
}

describe("background removal client", () => {
  test("posts the image as a transfer and resolves with the worker's mask", async () => {
    const { client, workers } = setup();
    const image = bitmap();
    const progress: number[] = [];
    const pending = client.remove({ image, width: 4, height: 2 }, { onProgress: (v) => progress.push(v) });

    const [worker] = workers;
    const { data, transfer } = worker.posted[0];
    expect(data).toMatchObject({ type: "segment", width: 4, height: 2 });
    expect(data.image).toBe(image);
    expect(transfer).toEqual([image]);

    worker.emit({ type: "progress", id: data.id, value: 0.4 });
    worker.emit({ type: "progress", id: data.id + 99, value: 0.9 });
    const mask = new Uint8Array(8).fill(7);
    worker.emit({ type: "result", id: data.id, mask, width: 4, height: 2, backend: "wasm", model: "network" });

    await expect(pending).resolves.toEqual({ width: 4, height: 2, data: mask });
    expect(progress).toEqual([0.4]);
    expect(client.lastBackend).toBe("wasm");
  });

  test("one worker serves consecutive requests", async () => {
    const { client, workers } = setup();
    const first = client.remove({ image: bitmap(), width: 1, height: 1 });
    workers[0].emit({ type: "result", id: workers[0].posted[0].data.id, mask: new Uint8Array(1), width: 1, height: 1, backend: "webgpu", model: "cache" });
    await first;
    const second = client.remove({ image: bitmap(), width: 1, height: 1 });
    workers[0].emit({ type: "result", id: workers[0].posted[1].data.id, mask: new Uint8Array(1), width: 1, height: 1, backend: "webgpu", model: "cache" });
    await second;
    expect(workers).toHaveLength(1);
    expect(client.lastBackend).toBe("webgpu");
  });

  test("a worker error rejects with its message", async () => {
    const { client, workers } = setup();
    const pending = client.remove({ image: bitmap(), width: 1, height: 1 });
    workers[0].emit({ type: "error", id: workers[0].posted[0].data.id, message: "model: checksum mismatch" });
    await expect(pending).rejects.toThrow("model: checksum mismatch");
  });

  test("cancelling terminates the worker and rejects as an abort; the next request gets a new worker", async () => {
    const { client, workers } = setup();
    const controller = new AbortController();
    const pending = client.remove({ image: bitmap(), width: 1, height: 1 }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0].terminated).toBe(true);

    void client.remove({ image: bitmap(), width: 1, height: 1 }).catch(() => {});
    expect(workers).toHaveLength(2);
    client.dispose();
    expect(workers[1].terminated).toBe(true);
  });

  test("an already aborted signal never reaches the worker", async () => {
    const { client, workers } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(client.remove({ image: bitmap(), width: 1, height: 1 }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(workers).toHaveLength(0);
  });

  test("a crashed worker fails what it was doing", async () => {
    const { client, workers } = setup();
    const pending = client.remove({ image: bitmap(), width: 1, height: 1 });
    workers[0].onerror?.({ message: "out of memory", preventDefault: () => {} } as ErrorEvent);
    await expect(pending).rejects.toThrow("out of memory");
    expect(workers[0].terminated).toBe(true);
  });
});
