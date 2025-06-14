import { defineStore } from "pinia";
import { v7 } from "uuid";
import { ref } from "vue";
//import PredictorWorker from "@/workers/predictor.webworker.ts?worker&inline";
export const usePredictor = defineStore("predictor", () => {
  const worker: Worker | null = null;
  const isReady = ref(false);
  const pendingRequests = new Map<
    string,
    {
      resolve: (value: any[]) => void;
      reject: (reason?: any) => void;
    }
  >();

  async function init() {
    try {
      indexedDB.deleteDatabase("tensorflowjs");
    } catch {}
    //worker = new PredictorWorker();

    /*worker.onmessage = (e) => {
      const { type, predictions, id } = e.data;
      if (type === "ready") {
        isReady.value = true;
        console.log(`Model loaded from ${e.data.from}`);
      }
      if (type === "result" && pendingRequests.has(id)) {
        const { resolve } = pendingRequests.get(id)!;
        resolve(predictions);
        pendingRequests.delete(id);
      }
    };

    worker.postMessage({ type: "init" });*/
  }

  async function blobToTensor(
    img: HTMLImageElement,
  ): Promise<ImageData | undefined> {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = img.width;
    canvas.height = img.height;

    ctx?.drawImage(img, 0, 0);

    const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height);

    if (!imageData) {
      return;
    }

    canvas.remove();
    return imageData;
  }

  async function classifyImage(img: HTMLImageElement) {
    if (!isReady.value) {
      throw new Error("Model is not loaded");
    }
    if (!worker) {
      throw new Error("Worker is not loaded");
    }

    const id = v7();
    const imageData = await blobToTensor(img);

    return new Promise<any[]>((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });

      worker.postMessage({
        type: "classify",
        imageData,
        id,
      });
    });
  }

  async function classifyImageBlob(img: Blob) {
    if (!isReady.value) {
      throw new Error("Model is not loaded");
    }
    if (!worker) {
      throw new Error("Worker is not loaded");
    }

    const id = v7();

    const imageElement = document.createElement("img");

    const imageData = await new Promise<any>((resolveImage, rejectImage) => {
      imageElement.onload = async () => {
        try {
          resolveImage(await blobToTensor(imageElement));
        } catch (error) {
          rejectImage(error);
        }
      };
      imageElement.onerror = () =>
        rejectImage(new Error("Failed to load image"));
      imageElement.src = URL.createObjectURL(img);
    });

    return new Promise<any[]>((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });

      worker.postMessage({
        type: "classify",
        imageData,
        id,
      });
    });
  }

  (window as any).classifyImage = classifyImage;

  return {
    init,
    classifyImage,
    classifyImageBlob,
  };
});
