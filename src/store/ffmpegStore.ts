import { defineStore } from "pinia";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { logger } from "@/lib/logger";

export const useFfmpeg = defineStore("ffmpeg", () => {
  const ffmpeg = new FFmpeg();

  async function init() {
    return;
    /*const baseURL = "/ffmpeg";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        "application/wasm"
      ),
    });

    ffmpeg.on("log", ({ type, message }) => {
      if (type == "stderr") logger.error(type, message);
      else logger.log(type, message);
    });*/
  }

  async function convertToJPEG(
    blob: Blob,
    inputName: string,
    outputName: string
  ): Promise<Blob> {
    const inputData = await fetchFile(blob);
    const result = await ffmpeg.createDir("/mounted");

    await ffmpeg.writeFile(`/mounted/${inputName}`, inputData);
    const args = ["-i", `/mounted/${inputName}`, `/mounted/${outputName}`];
    logger.log(`start converting ffmpeg`, args, result);

    await ffmpeg.exec(args);
    const outputData = await ffmpeg.readFile(outputName);

    return new Blob([outputData], { type: "image/jpeg" });
  }

  return {
    init,

    convertToJPEG,
  };
});
