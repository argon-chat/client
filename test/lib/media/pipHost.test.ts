/**
 * Continue in picture-in-picture: a video in PiP whose player went away moves into a hidden host on
 * <body> and plays on; leaving PiP stops it and lets it go, and the host goes with the last video.
 */

import { describe, test, expect, afterEach } from "vitest";
import { continueInPictureInPicture, hasContinuedPictureInPicture } from "@/lib/media/pipHost";

let pipElement: Element | null = null;
Object.defineProperty(document, "pictureInPictureElement", { configurable: true, get: () => pipElement });

afterEach(() => {
  pipElement = null;
  document.body.innerHTML = "";
});

function videoIn(parent: HTMLElement): HTMLVideoElement {
  const video = document.createElement("video");
  video.setAttribute("src", "https://s3.test/v.mp4");
  parent.appendChild(video);
  return video;
}

describe("continueInPictureInPicture", () => {
  test("a video that is not in PiP is left alone", () => {
    const player = document.body.appendChild(document.createElement("div"));
    const video = videoIn(player);
    expect(continueInPictureInPicture(video)).toBe(false);
    expect(video.parentElement).toBe(player);
    expect(document.querySelector("[data-testid=pip-host]")).toBeNull();
  });

  test("the PiP video moves into the hidden host and keeps its source; leaving PiP lets it go", () => {
    const player = document.body.appendChild(document.createElement("div"));
    const video = videoIn(player);
    pipElement = video;

    expect(continueInPictureInPicture(video)).toBe(true);
    const host = document.querySelector<HTMLElement>("[data-testid=pip-host]")!;
    expect(host).not.toBeNull();
    expect(video.parentElement).toBe(host);
    expect(video.getAttribute("src")).toBe("https://s3.test/v.mp4");
    expect(hasContinuedPictureInPicture()).toBe(true);

    pipElement = null;
    video.dispatchEvent(new Event("leavepictureinpicture"));
    expect(video.isConnected).toBe(false);
    expect(video.hasAttribute("src")).toBe(false);
    expect(hasContinuedPictureInPicture()).toBe(false);
    expect(document.querySelector("[data-testid=pip-host]")).toBeNull();
  });
});
