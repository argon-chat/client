import type { EditorLayer, FontInfo, FontKey, TextStyle } from './types';
import { DEFAULT_TEXT_STYLE, FONT_REGISTRY, TEXT_PLACEHOLDER } from './constants';

const STYLESHEET_ID = 'media-editor-fonts';
const STYLESHEET_URL = 'https://fonts.googleapis.com/css2?family=Chewy&family=Courier+Prime:wght@400;700&family=Fugaz+One&family=Playwrite+BE+VLG&family=Roboto:wght@400;500;700&family=Rubik+Bubbles&family=Sedan&family=Suez+One&display=swap';
const EXPORT_FONT_TIMEOUT = 5000;

const stylesheets = new WeakMap<HTMLLinkElement, Promise<void>>();

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

/** Adds the fonts' stylesheet once; resolves when it is in, or has failed and the text falls back. */
export function loadEditorFonts(): Promise<void> {
  let link = document.getElementById(STYLESHEET_ID) as HTMLLinkElement | null;
  if (!link) {
    link = Object.assign(document.createElement('link'), { id: STYLESHEET_ID, rel: 'stylesheet', href: STYLESHEET_URL });
    document.head.appendChild(link);
  }
  let loaded = stylesheets.get(link);
  if (!loaded) {
    loaded = link.sheet ? Promise.resolve() : whenLoaded(link);
    stylesheets.set(link, loaded);
  }
  return loaded;
}

function whenLoaded(link: HTMLLinkElement): Promise<void> {
  return new Promise((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => {
      console.warn('[media-editor] the font stylesheet did not load; text falls back to the default font');
      // The next open adds it again.
      link.remove();
      resolve();
    }, { once: true });
  });
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
