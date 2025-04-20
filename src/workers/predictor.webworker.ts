import * as nsfwjs from "nsfwjs";
import * as tf from "@tensorflow/tfjs";

let model: nsfwjs.NSFWJS | null = null;
async function loadModel() {
  const models = await tf.io.listModels();
  if ("indexeddb://predictor" in models) {
    model = await nsfwjs.load("indexeddb://predictor", { size: 299 });
    postMessage({ type: "ready", from: "indexeddb" });
  } else {
    const modelUrl = new URL('/p/model.json', self.location.origin).toString();
    const m = await nsfwjs.load(modelUrl, { size: 299 });
    await m.model.save("indexeddb://predictor");
    model = m;
    postMessage({ type: "ready", from: "network" });
  }
}
self.onmessage = async (e) => {
  const { type, imageData, id } = e.data;

  if (type === "init") {
    await loadModel();
  }

  if (type === "classify" && model && imageData) {
    const predictions = await model.classify(imageData);
    postMessage({ type: "result", predictions, id });
  }
};
