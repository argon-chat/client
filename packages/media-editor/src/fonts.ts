import type { EditorLayer, FontInfo, FontKey, TextStyle } from './types';
import { DEFAULT_TEXT_STYLE, FONT_REGISTRY, TEXT_PLACEHOLDER } from './constants';

import robotoUrl from './assets/fonts/roboto/Roboto-Medium.ttf?url';
import suezUrl from './assets/fonts/suezone/SuezOne-Regular.ttf?url';
import bubblesUrl from './assets/fonts/rubikbubbles/RubikBubbles-Regular.ttf?url';
import playwriteUrl from './assets/fonts/playwritebevlg/PlaywriteBEVLG[wght].ttf?url';
import chewyUrl from './assets/fonts/chewy/Chewy-Regular.ttf?url';
import courierUrl from './assets/fonts/courierprime/CourierPrime-Bold.ttf?url';
import fugazUrl from './assets/fonts/fugazone/FugazOne-Regular.ttf?url';
import sedanUrl from './assets/fonts/sedan/Sedan-Regular.ttf?url';

const FONT_URLS: Record<FontKey, string> = {
  roboto: robotoUrl, suez: suezUrl, bubbles: bubblesUrl, playwrite: playwriteUrl,
  chewy: chewyUrl, courier: courierUrl, fugaz: fugazUrl, sedan: sedanUrl,
};
const EXPORT_FONT_TIMEOUT = 5000;
let editorFonts: Promise<void> | undefined;

/** An unknown key (a state saved by another version) gets the default font rather than no text. */
export function fontInfo(key: FontKey): FontInfo {
  return FONT_REGISTRY[key] ?? FONT_REGISTRY[DEFAULT_TEXT_STYLE.font];
}

/** The canvas `font` of a text layer: what the preview's CSS asks for. */
export function canvasFont(info: TextStyle): string {
  const { fontWeight, fontFamily } = fontInfo(info.font);
  return `${fontWeight} ${info.size}px ${fontFamily}`;
}

export function layerText(info?: TextStyle): string {
  return info?.content || TEXT_PLACEHOLDER;
}

/** Local faces work identically offline, in browsers and in the native host. */
export function loadEditorFonts(): Promise<void> {
  if (!editorFonts) {
    editorFonts = Promise.all(Object.entries(FONT_URLS).map(async ([key, url]) => {
      const info = fontInfo(key as FontKey);
      const family = info.fontFamily.replace(/['"]/g, '');
      const face = new FontFace(family, `url("${url}")`, { weight: String(info.fontWeight), style: 'normal' });
      try {
        await face.load();
        document.fonts.add(face);
      } catch (error) {
        console.warn(`[media-editor] bundled font ${family} did not load; using the fallback face`, error);
      }
    })).then(() => undefined);
  }
  return editorFonts;
}

/**
 * Canvas text is drawn with whatever face is loaded at that moment, and a face only loads once
 * something asks for it, so the export asks for every text layer's first. Bounded: a font that never
 * arrives costs the fallback face, not the export.
 */
export async function loadLayerFonts(layers: EditorLayer[], timeout = EXPORT_FONT_TIMEOUT): Promise<void> {
  const texts = layers.flatMap((layer) => (layer.type === 'text' && layer.textInfo ? [layer.textInfo] : []));
  if (!texts.length) return;

  const load = async () => {
    await loadEditorFonts();
    await Promise.all(texts.map(async (info) => {
      const font = canvasFont(info);
      try {
        await document.fonts.load(font, layerText(info));
      } catch (e) {
        console.warn(`[media-editor] ${font} did not load; the text falls back to the default font`, e);
      }
    }));
    await document.fonts.ready;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<true>((resolve) => { timer = setTimeout(() => resolve(true), timeout); });
  const late = await Promise.race([load().then(() => false), expired]);
  clearTimeout(timer);
  if (late) console.warn(`[media-editor] fonts still loading after ${timeout} ms; text may use the fallback font`);
}
