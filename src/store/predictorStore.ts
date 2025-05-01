import { defineStore } from "pinia";
import { ref } from "vue";
import { v7 } from "uuid";
//import PredictorWorker from "@/workers/predictor.webworker.ts?worker&inline";
export const usePredictor = defineStore("predictor", () => {
  let worker: Worker | null = null;
  const isReady = ref(false);
  let pendingRequests = new Map<
    string,
    { resolve: Function; reject: Function }
  >();

  async function init() {
    try {
      indexedDB.deleteDatabase("tensorflowjs")
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

  async function blobToTensor(img: HTMLImageElement): Promise<ImageData> {

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;

    ctx!.drawImage(img, 0, 0);

    const imageData = ctx!.getImageData(0, 0, canvas.width, canvas.height);

    canvas.remove();
    return imageData;
  }

  async function blobToTensorBlob(blob: Blob): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
  
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
  
        canvas.width = img.width;
        canvas.height = img.height;
  
        ctx!.drawImage(img, 0, 0);
        const imageData = ctx!.getImageData(0, 0, canvas.width, canvas.height);
  
        canvas.remove();
        URL.revokeObjectURL(url);
  
        resolve(imageData);
      };
  
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
  
      img.src = url;
    });
  }


  async function classifyImage(img: HTMLImageElement) {
    return new Promise<any[]>(async (resolve, reject) => {
      if (!isReady.value) {
        reject("Model is not loaded");
        return;
      }
      if (!worker) {
        reject("Worker is not loaded");
        return;
      }

      const id = v7();

      pendingRequests.set(id, { resolve, reject });

      worker.postMessage({ type: "classify", imageData: await blobToTensor(img), id });
    });
  }

  async function classifyImageBlob(img: Blob) {
    return new Promise<any[]>(async (resolve, reject) => {
      if (!isReady.value) {
        reject("Model is not loaded");
        return;
      }
      if (!worker) {
        reject("Worker is not loaded");
        return;
      }

      const id = v7();

      pendingRequests.set(id, { resolve, reject });

      worker.postMessage({ type: "classify", imageData: await blobToTensorBlob(img), id });
    });
  }

  (window as any)["classifyImage"] = classifyImage;

  return {
    init,
    classifyImage,
    classifyImageBlob
  };
});
