/**
 * Undo and redo: every kind of edit is one history entry, a continuous edit (a drag, a slider, a
 * typed text, a zoom with the wheel) is one entry however many steps it takes, Esc puts an edit in
 * progress back without a trace, and the editor knows whether anything is unsaved.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useMediaEditorStore, REMOVE_ARRAY_ITEM, UI_PATH, type EditingMediaState } from "../src/store/editorStore";
import type { EditorLayer, Vec2 } from "../src/types";

beforeEach(() => {
  setActivePinia(createPinia());
});

function open(mode: "full" | "sticker" = "full") {
  const store = useMediaEditorStore();
  store.init({ src: "blob:x", type: "image", mode });
  return store;
}

const textLayer = (id: number, content = "Text"): EditorLayer => ({
  id,
  type: "text",
  position: [100, 100],
  rotation: 0,
  scale: 1,
  textInfo: { color: "#ffffff", alignment: "left", style: "outline", size: 40, font: "roboto", content },
});

describe("entries", () => {
  test("a value set is one entry, undone and redone; setting it to what it is records nothing", () => {
    const store = open();
    store.set(["adjustments", "brightness"], 0.3);
    store.set(["adjustments", "brightness"], 0.3);
    expect(store.mediaState.history).toHaveLength(1);
    store.undo();
    expect(store.mediaState.adjustments.brightness).toBe(0);
    store.redo();
    expect(store.mediaState.adjustments.brightness).toBe(0.3);
  });

  test("curves, selective colour, perspective and video quality each go through the history", () => {
    const store = open();
    store.set(["curves", "r"], [0.2, -0.1]);
    store.set(["selective", "hue"], 0.5);
    store.set(["perspective"], [0.1, 0]);
    store.set(["videoQuality"], 720);
    expect(store.mediaState.history).toHaveLength(4);
    for (let i = 0; i < 4; i++) store.undo();
    expect(store.mediaState.curves.r).toEqual([0, 0]);
    expect(store.mediaState.selective.hue).toBe(0);
    expect(store.mediaState.perspective).toEqual([0, 0]);
    expect(store.mediaState.videoQuality).toBe(0);
  });

  test("a preset replaces every adjustment as one entry", () => {
    const store = open();
    const before = { ...store.mediaState.adjustments };
    store.batch(() => {
      store.set(["adjustments", "saturation"], 0.4);
      store.set(["adjustments", "contrast"], 0.15);
    });
    expect(store.mediaState.history).toHaveLength(1);
    store.undo();
    expect(store.mediaState.adjustments).toEqual(before);
  });

  test("a crop change (scale, translation, ratio and the ratio's key) is one entry", () => {
    const store = open();
    store.change([["scale"], ["translation"], ["currentImageRatio"], [UI_PATH, "fixedImageRatioKey"]], () => {
      store.mediaState.scale = 1.5;
      store.mediaState.translation = [10, -4];
      store.mediaState.currentImageRatio = 1;
      store.uiState.fixedImageRatioKey = "1x1";
    });
    expect(store.mediaState.history).toHaveLength(1);
    store.undo();
    expect(store.mediaState.scale).toBe(1);
    expect(store.mediaState.translation).toEqual([0, 0]);
    expect(store.mediaState.currentImageRatio).toBe(0);
    expect(store.uiState.fixedImageRatioKey).toBeUndefined();
    store.redo();
    expect(store.mediaState.scale).toBe(1.5);
    expect(store.mediaState.translation).toEqual([10, -4]);
    expect(store.uiState.fixedImageRatioKey).toBe("1x1");
  });

  test("rotation (with the wheel's position) and flip", () => {
    const store = open();
    store.change([["rotation"], [UI_PATH, "rotationWheel"]], () => {
      store.mediaState.rotation = 0.3;
      store.uiState.rotationWheel = -50;
    });
    store.change([["flip"]], () => {
      store.mediaState.flip = [-1, 1];
    });
    store.undo();
    expect(store.mediaState.flip).toEqual([1, 1]);
    store.undo();
    expect(store.mediaState.rotation).toBe(0);
    expect(store.uiState.rotationWheel).toBe(0);
  });

  test("layers: add, move, type, restyle and delete are one entry each", () => {
    const store = open();
    store.addLayer(textLayer(1));
    // Move: a drag tracked from start to end.
    const move = store.beginGesture({ track: [["resizableLayers", 0, "position"]] });
    for (let x = 101; x <= 140; x++) store.mediaState.resizableLayers[0].position = [x, 100];
    move.end();
    // Typing: from opening the text to leaving it.
    const typing = store.beginGesture({ track: [["resizableLayers", 0, "textInfo", "content"]] });
    for (const s of ["H", "He", "Hel", "Hello"]) store.mediaState.resizableLayers[0].textInfo!.content = s;
    typing.end();
    // A style click writes several fields.
    store.batch(() => {
      store.set(["resizableLayers", 0, "textInfo", "color"], "#ff0000");
      store.set(["resizableLayers", 0, "textInfo", "size"], 40);
      store.set(["resizableLayers", 0, "textInfo", "font"], "chewy");
    });
    store.uiState.selectedResizableLayer = 1;
    expect(store.removeLayer(1)).toBe(true);
    expect(store.uiState.selectedResizableLayer).toBeUndefined();
    expect(store.mediaState.history).toHaveLength(5);

    store.undo();
    expect(store.mediaState.resizableLayers[0].textInfo).toMatchObject({ color: "#ff0000", font: "chewy", content: "Hello" });
    store.undo();
    expect(store.mediaState.resizableLayers[0].textInfo).toMatchObject({ color: "#ffffff", font: "roboto" });
    store.undo();
    expect(store.mediaState.resizableLayers[0].textInfo!.content).toBe("Text");
    store.undo();
    expect(store.mediaState.resizableLayers[0].position).toEqual([100, 100]);
    store.undo();
    expect(store.mediaState.resizableLayers).toEqual([]);
    for (let i = 0; i < 5; i++) store.redo();
    expect(store.mediaState.resizableLayers).toEqual([]);
    store.undo();
    expect(store.mediaState.resizableLayers[0]).toMatchObject({ position: [140, 100], textInfo: { content: "Hello", color: "#ff0000" } });
  });

  test("brush lines and mask edits are one entry each", () => {
    const store = open("sticker");
    store.addBrushLine({ color: "#fff", brush: "pen", size: 4, points: [[1, 1], [2, 2]] });
    store.addMaskStroke({ mode: "erase", size: 4, points: [[1, 1]] });
    store.eraseSelection([[0, 0], [10, 0], [10, 10]], "inside");
    store.addMaskErase({ x: 0, y: 0, width: 1, height: 1, data: new Uint8Array([255]) }, 1);
    store.setMaskSource(store.addMaskSource({ width: 1, height: 1, data: new Uint8Array([0]) }));
    store.setOutline("enabled", true);
    expect(store.mediaState.history).toHaveLength(6);
    expect(store.mediaState.history[0]).toMatchObject({ path: ["brushDrawnLines", 0], oldValue: REMOVE_ARRAY_ITEM });
    for (let i = 0; i < 6; i++) store.undo();
    expect(store.mediaState.brushDrawnLines).toEqual([]);
    expect(store.mediaState.mask).toEqual({ source: null, feather: 0, strokes: [] });
    expect(store.mediaState.outline.enabled).toBe(false);
  });

  test("history keeps copies: editing the state after an undo does not edit the history", () => {
    const store = open();
    store.addLayer(textLayer(1));
    store.undo();
    store.redo();
    store.mediaState.resizableLayers[0].position = [5, 5];
    store.undo();
    store.redo();
    expect(store.mediaState.resizableLayers[0].position).toEqual([100, 100]);
  });
});

describe("continuous edits", () => {
  test("a slider drag is one entry from where it started to where it stopped", () => {
    const store = open("sticker");
    const g = store.beginGesture();
    for (let r = 9; r <= 20; r++) store.setOutline("radius", r);
    expect(store.uiState.gesture).toBe(true);
    expect(store.mediaState.history).toHaveLength(0);
    expect(g.end()).toBe(true);
    expect(store.uiState.gesture).toBe(false);
    expect(store.mediaState.history).toEqual([{ path: ["outline", "radius"], oldValue: 8, newValue: 20 }]);
    store.undo();
    expect(store.mediaState.outline.radius).toBe(8);
  });

  test("soft edges and adjustments on sliders coalesce the same way", () => {
    const store = open("sticker");
    let g = store.beginGesture();
    for (let f = 1; f <= 6; f++) store.setMaskFeather(f);
    g.end();
    g = store.beginGesture();
    for (let v = 0.01; v <= 0.5; v += 0.01) store.set(["adjustments", "contrast"], Math.round(v * 100) / 100);
    g.end();
    expect(store.mediaState.history).toHaveLength(2);
    expect(store.mediaState.history[0]).toMatchObject({ oldValue: 0, newValue: 6 });
  });

  test("a drag that ends where it started records nothing", () => {
    const store = open();
    const g = store.beginGesture({ track: [["translation"]] });
    store.mediaState.translation = [20, 0];
    store.mediaState.translation = [0, 0];
    expect(g.end()).toBe(false);
    const s = store.beginGesture();
    store.set(["adjustments", "fade"], 0.4);
    store.set(["adjustments", "fade"], 0);
    s.end();
    expect(store.mediaState.history).toHaveLength(0);
  });

  test("Esc: the gesture's changes go back, nothing is recorded, the owner hears of it", () => {
    const store = open();
    store.set(["scale"], 2);
    store.undo(); // something to redo
    const onCancel = vi.fn();
    const g = store.beginGesture({ track: [["translation"]], onCancel });
    store.mediaState.translation = [30, 30];
    store.set(["adjustments", "warmth"], 0.5);
    expect(store.cancelGesture()).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(g.active).toBe(false);
    expect(store.mediaState.translation).toEqual([0, 0]);
    expect(store.mediaState.adjustments.warmth).toBe(0);
    expect(store.mediaState.history).toHaveLength(0);
    expect(store.mediaState.redoHistory).toHaveLength(1);
    expect(store.cancelGesture()).toBe(false);
  });

  test("undo and redo wait while a gesture is open; a new edit clears what could be redone", () => {
    const store = open();
    store.set(["scale"], 2);
    const g = store.beginGesture();
    store.undo();
    expect(store.mediaState.scale).toBe(2);
    expect(store.canUndo).toBe(false);
    g.end();
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.canRedo).toBe(true);
    store.set(["scale"], 3);
    expect(store.canRedo).toBe(false);
  });

  test("a gesture begun while another is open ends the first; batch and change join an open one", () => {
    const store = open();
    const first = store.beginGesture({ track: [["rotation"]] });
    store.mediaState.rotation = 1;
    const second = store.beginGesture();
    expect(first.active).toBe(false);
    expect(store.mediaState.history).toHaveLength(1);
    store.batch(() => store.set(["adjustments", "grain"], 0.2));
    store.change([["flip"]], () => {
      store.mediaState.flip = [-1, 1];
    });
    second.end();
    expect(store.mediaState.history).toHaveLength(2);
    store.undo();
    expect(store.mediaState.flip).toEqual([1, 1]);
    expect(store.mediaState.adjustments.grain).toBe(0);
    expect(store.mediaState.rotation).toBe(1);
  });

  test("a tracked path covers what was pushed under it", () => {
    const store = open();
    store.addLayer(textLayer(1));
    const typing = store.beginGesture({ track: [["resizableLayers", 0, "textInfo"]] });
    store.mediaState.resizableLayers[0].textInfo!.content = "A";
    store.set(["resizableLayers", 0, "textInfo", "color"], "#000000");
    store.mediaState.resizableLayers[0].textInfo!.content = "AB";
    typing.end();
    store.undo();
    expect(store.mediaState.resizableLayers[0].textInfo).toMatchObject({ content: "Text", color: "#ffffff" });
    store.redo();
    expect(store.mediaState.resizableLayers[0].textInfo).toMatchObject({ content: "AB", color: "#000000" });
  });
});

describe("unsaved changes", () => {
  test("dirty once the history moves off where it was opened; back there, clean", () => {
    const store = open();
    expect(store.isDirty).toBe(false);
    store.set(["scale"], 2);
    expect(store.isDirty).toBe(true);
    store.undo();
    expect(store.isDirty).toBe(false);
    store.redo();
    expect(store.isDirty).toBe(true);
    store.undo();
    store.set(["scale"], 3);
    expect(store.isDirty).toBe(true);
    store.markSaved();
    expect(store.isDirty).toBe(false);
  });

  test("an open drag is not yet a change; tool and view state never are", () => {
    const store = open("sticker");
    const g = store.beginGesture({ track: [["translation"]] });
    store.mediaState.translation = [4, 4];
    expect(store.isDirty).toBe(false);
    g.end();
    expect(store.isDirty).toBe(true);
    store.undo();
    store.uiState.cutoutTool = "lasso";
    store.uiState.selection = { points: [[0, 0], [1, 0], [1, 1]] as Vec2[], inverted: false };
    store.uiState.currentTab = "crop";
    expect(store.isDirty).toBe(false);
  });

  test("an editor opened with a saved state is clean until it changes", () => {
    const store = open();
    store.set(["scale"], 2);
    const saved = JSON.parse(JSON.stringify(store.mediaState)) as EditingMediaState;
    store.init({ src: "blob:y", type: "image", initialState: saved });
    expect(store.isDirty).toBe(false);
    store.undo();
    expect(store.isDirty).toBe(true);
    expect(store.mediaState.scale).toBe(1);
  });
});
