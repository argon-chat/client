/**
 * Test setup - configures happy-dom for DOM environment
 */
import { Window } from 'happy-dom';

const window = new Window({ url: 'https://localhost:8080/' });

// Register globals
(globalThis as any).window = window;
(globalThis as any).document = window.document;
(globalThis as any).navigator = window.navigator;
(globalThis as any).location = window.location;
(globalThis as any).localStorage = window.localStorage;
(globalThis as any).sessionStorage = window.sessionStorage;
(globalThis as any).HTMLElement = window.HTMLElement;
(globalThis as any).HTMLCanvasElement = window.HTMLCanvasElement;
(globalThis as any).HTMLIFrameElement = window.HTMLIFrameElement;
(globalThis as any).HTMLDivElement = window.HTMLDivElement;
(globalThis as any).Event = window.Event;
(globalThis as any).KeyboardEvent = window.KeyboardEvent;
(globalThis as any).MouseEvent = window.MouseEvent;
(globalThis as any).FocusEvent = window.FocusEvent;
(globalThis as any).MessageEvent = window.MessageEvent;
(globalThis as any).CustomEvent = window.CustomEvent;
(globalThis as any).requestAnimationFrame = window.requestAnimationFrame.bind(window);
(globalThis as any).cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
