/// <reference lib="webworker" />
import cpuWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import gpuWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jspi.wasm?url";
import { BG_MODEL } from "./model";
import { fetchWithProgress, loadModel } from "./modelCache";
import { segment, type RgbaImage, type SaliencySession } from "./bgRemovalPipeline";
import type { BgRemovalBackend, BgRemovalEvent, BgRemovalRequest } from "./bgRemovalProtocol";

// Background removal off the main thread: onnxruntime-web runs U²-Netp on the WebGPU execution
// provider when there is an adapter (the JSPI build: it is the WebGPU build under Cloudflare's
// 25 MiB per-file limit), on the single-threaded wasm one otherwise. The runtime and the model are
// fetched here, with progress, and the session is kept for the next image.

declare const self: DedicatedWorkerGlobalScope;

type Ort = typeof import("onnxruntime-web");

interface Runtime {
  session: SaliencySession;
  backend: BgRemovalBackend;
  model: "cache" | "network";
}

// Most of a first run is downloading: runtime and model share the first 70 %, by size.
const LOAD_SHARE = 0.7;
const APPROX_WASM_BYTES = { webgpu: 16_760_000, wasm: 14_240_000 } as const;

let runtime: Promise<Runtime> | null = null;
let runtimeBackend: BgRemovalBackend | null = null;

async function pickBackend(requested?: BgRemovalBackend): Promise<BgRemovalBackend> {
  if (requested === "wasm") return "wasm";
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu || typeof (WebAssembly as unknown as { Suspending?: unknown }).Suspending !== "function") return "wasm";
  try {
    return (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

async function createRuntime(requested: BgRemovalBackend | undefined, progress: (value: number) => void): Promise<Runtime> {
  const backend = await pickBackend(requested);
  const ort: Ort = backend === "webgpu" ? await import("onnxruntime-web/jspi") : await import("onnxruntime-web/wasm");

  const wasmBytes = APPROX_WASM_BYTES[backend];
  const total = wasmBytes + BG_MODEL.bytes;
  let wasmDone = 0;
  let modelDone = 0;
  const report = () => progress(((wasmDone * wasmBytes + modelDone * BG_MODEL.bytes) / total) * LOAD_SHARE);

  const wasmUrl = new URL(backend === "webgpu" ? gpuWasmUrl : cpuWasmUrl, self.location.href).href;
  const [wasmBinary, model] = await Promise.all([
    fetchWithProgress(wasmUrl, {
      expected: wasmBytes,
      onProgress: (v) => {
        wasmDone = v;
        report();
      },
    }),
    loadModel(BG_MODEL, {
      origin: self.location.origin,
      onProgress: (v) => {
        modelDone = v;
        report();
      },
    }),
  ]);

  // One thread: the app is not cross-origin isolated, and nested workers would need the glue file.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmBinary = wasmBinary;

  const session = await ort.InferenceSession.create(new Uint8Array(model.bytes), {
    executionProviders: backend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"],
    graphOptimizationLevel: "all",
  });
  progress(LOAD_SHARE + 0.1);

  const input = session.inputNames[0];
  const output = session.outputNames[0];
  return {
    backend,
    model: model.from,
    session: {
      async run(data, dims) {
        const tensor = new ort.Tensor("float32", data, [...dims]);
        try {
          const result = await session.run({ [input]: tensor });
          const out = result[output];
          const values = out.data as Float32Array;
          for (const name of Object.keys(result)) if (name !== output) result[name].dispose();
          return { data: values, dims: out.dims };
        } finally {
          tensor.dispose();
        }
      },
    },
  };
}

// Big photos are shrunk by the browser first; the model only sees 320×320 anyway.
const PIXELS_LONG_SIDE = 640;

async function pixelsOf(image: ImageBitmap): Promise<RgbaImage> {
  const k = Math.min(1, PIXELS_LONG_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * k));
  const height = Math.max(1, Math.round(image.height * k));
  const small = k < 1 ? await createImageBitmap(image, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" }) : image;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(small, 0, 0);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  } finally {
    if (small !== image) small.close();
  }
}

function post(event: BgRemovalEvent, transfer: Transferable[] = []) {
  self.postMessage(event, transfer);
}

let queue: Promise<void> = Promise.resolve();

async function handle(request: BgRemovalRequest) {
  const { id } = request;
  const progress = (value: number) => post({ type: "progress", id, value });
  try {
    const fresh = !runtime || (request.backend === "wasm" && runtimeBackend !== "wasm");
    if (fresh) {
      const created = createRuntime(request.backend, progress);
      runtime = created;
      runtimeBackend = request.backend === "wasm" ? "wasm" : null;
      created.catch(() => {
        if (runtime === created) runtime = null;
      });
    }
    const { session, backend, model } = await runtime!;
    runtimeBackend = backend;
    const base = fresh ? LOAD_SHARE + 0.1 : 0.1;
    const pixels = await pixelsOf(request.image);
    const mask = await segment(session, pixels, request.width, request.height, {
      feather: request.feather,
      onProgress: (stage) => progress(stage === "prepare" ? base : stage === "infer" ? base + 0.05 : 0.97),
    });
    post({ type: "result", id, mask, width: request.width, height: request.height, backend, model }, [mask.buffer]);
  } catch (e) {
    post({ type: "error", id, message: e instanceof Error ? e.message : String(e) });
  } finally {
    request.image.close();
  }
}

self.onmessage = (e: MessageEvent<BgRemovalRequest>) => {
  if (e.data?.type !== "segment") return;
  queue = queue.then(() => handle(e.data));
};
