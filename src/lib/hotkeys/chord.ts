/**
 * A hotkey chord as the host reports and stores it, and how it is shown to people.
 *
 * Keyboard buttons carry Windows virtual-key codes on every platform (one naming table, and a
 * binding survives a move between machines). A key VK has no code for (numpad Enter, the numpad
 * navigation keys with NumLock off) arrives as `RAW_KEY_FLAG | keycode` from the host and is named
 * here from a small table of its own. Mouse buttons are numbered 1 left, 2 right, 3 middle,
 * 4 back, 5 forward; the host never records 1 and 2.
 */

export interface HotkeyButton {
  /** 0 keyboard, 1 mouse (HostProc.ion HotkeyDevice). */
  device: number;
  code: number;
}

export interface HotkeyChord {
  buttons: HotkeyButton[];
}

export const KEYBOARD = 0;
export const MOUSE = 1;
export const RAW_KEY_FLAG = 0x10000;

export type HotkeyPlatform = "mac" | "win";

export function detectHotkeyPlatform(): HotkeyPlatform {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Mac") ? "mac" : "win";
}

const buttonKey = (b: HotkeyButton): string => `${b.device}:${b.code}`;

export function isEmptyChord(chord: HotkeyChord | null | undefined): boolean {
  return !chord || !Array.isArray(chord.buttons) || chord.buttons.length === 0;
}

/** Same buttons, in any order. */
export function chordEquals(a: HotkeyChord | null | undefined, b: HotkeyChord | null | undefined): boolean {
  if (isEmptyChord(a) || isEmptyChord(b)) return isEmptyChord(a) && isEmptyChord(b);
  const keys = new Set(a!.buttons.map(buttonKey));
  if (keys.size !== new Set(b!.buttons.map(buttonKey)).size) return false;
  return b!.buttons.every((btn) => keys.has(buttonKey(btn)));
}

/** Drops duplicates and orders the buttons the way they are displayed, so storage is canonical. */
export function normalizeChord(chord: HotkeyChord): HotkeyChord {
  const seen = new Set<string>();
  const buttons = chord.buttons.filter((b) => {
    if (!b || typeof b.code !== "number") return false;
    const key = buttonKey(b);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { buttons: sortButtons(buttons) };
}

// ── Naming ───────────────────────────────────────────────────────────────────

/** Display rank: modifiers first in the conventional order, then everything else in press order. */
const MODIFIER_RANK: Record<number, number> = {
  0x11: 1, 0xa2: 1, 0xa3: 1, // Ctrl
  0x12: 2, 0xa4: 2, 0xa5: 2, // Alt / Option
  0x10: 3, 0xa0: 3, 0xa1: 3, // Shift
  0x5b: 4, 0x5c: 4, // Win / Cmd
};

export function isModifierButton(b: HotkeyButton): boolean {
  return b.device !== MOUSE && MODIFIER_RANK[b.code] !== undefined;
}

function sortButtons(buttons: HotkeyButton[]): HotkeyButton[] {
  return buttons
    .map((b, i) => ({ b, i, rank: b.device === MOUSE ? 9 : (MODIFIER_RANK[b.code] ?? 8) }))
    .sort((x, y) => x.rank - y.rank || x.i - y.i)
    .map((x) => x.b);
}

const MODIFIER_NAMES: Record<HotkeyPlatform, Record<number, string>> = {
  win: {
    0x11: "Ctrl", 0xa2: "Ctrl", 0xa3: "Right Ctrl",
    0x12: "Alt", 0xa4: "Alt", 0xa5: "Right Alt",
    0x10: "Shift", 0xa0: "Shift", 0xa1: "Right Shift",
    0x5b: "Win", 0x5c: "Right Win",
  },
  mac: {
    0x11: "⌃", 0xa2: "⌃", 0xa3: "Right ⌃",
    0x12: "⌥", 0xa4: "⌥", 0xa5: "Right ⌥",
    0x10: "⇧", 0xa0: "⇧", 0xa1: "Right ⇧",
    0x5b: "⌘", 0x5c: "Right ⌘",
  },
};

const VK_NAMES: Record<number, string> = {
  0x08: "Backspace", 0x09: "Tab", 0x0d: "Enter", 0x13: "Pause", 0x14: "Caps Lock", 0x1b: "Esc",
  0x20: "Space", 0x21: "Page Up", 0x22: "Page Down", 0x23: "End", 0x24: "Home",
  0x25: "←", 0x26: "↑", 0x27: "→", 0x28: "↓",
  0x2c: "Print Screen", 0x2d: "Insert", 0x2e: "Delete", 0x5d: "Menu", 0x5f: "Sleep",
  0x6a: "Num *", 0x6b: "Num +", 0x6d: "Num -", 0x6e: "Num .", 0x6f: "Num /",
  0x90: "Num Lock", 0x91: "Scroll Lock",
  0xa6: "Browser Back", 0xa7: "Browser Forward", 0xa8: "Browser Refresh", 0xa9: "Browser Stop",
  0xaa: "Browser Search", 0xab: "Browser Favorites", 0xac: "Browser Home",
  0xad: "Mute", 0xae: "Volume Down", 0xaf: "Volume Up",
  0xb0: "Next Track", 0xb1: "Previous Track", 0xb2: "Stop Media", 0xb3: "Play/Pause",
  0xb4: "Mail", 0xb5: "Media", 0xb7: "Calculator",
  0xba: ";", 0xbb: "=", 0xbc: ",", 0xbd: "-", 0xbe: ".", 0xbf: "/", 0xc0: "`",
  0xdb: "[", 0xdc: "\\", 0xdd: "]", 0xde: "'", 0xe2: "<>",
};
for (let i = 0; i < 26; i++) VK_NAMES[0x41 + i] = String.fromCharCode(65 + i);
for (let i = 0; i < 10; i++) VK_NAMES[0x30 + i] = String(i);
for (let i = 0; i < 24; i++) VK_NAMES[0x70 + i] = `F${i + 1}`;
for (let i = 0; i < 10; i++) VK_NAMES[0x60 + i] = `Num ${i}`;

/** Keys uiohook knows and VK does not, by raw keycode. */
const RAW_NAMES: Record<number, string> = {
  0x0e1c: "Num Enter",
  0x007e: "Num ,",
  0xee52: "Num Insert", 0xee53: "Num Delete", 0xee47: "Num Home", 0xee4f: "Num End",
  0xee49: "Num Page Up", 0xee51: "Num Page Down",
  0xee48: "Num ↑", 0xee50: "Num ↓", 0xee4b: "Num ←", 0xee4d: "Num →",
  0xe05e: "Power",
};

const MOUSE_NAMES: Record<number, string> = {
  1: "Mouse 1", 2: "Mouse 2", 3: "Middle Click", 4: "Mouse 4", 5: "Mouse 5",
};

export function buttonLabel(b: HotkeyButton, platform: HotkeyPlatform = detectHotkeyPlatform()): string {
  if (b.device === MOUSE) return MOUSE_NAMES[b.code] ?? `Mouse ${b.code}`;
  const modifier = MODIFIER_NAMES[platform][b.code];
  if (modifier) return modifier;
  if (b.code & RAW_KEY_FLAG) {
    const raw = b.code & ~RAW_KEY_FLAG;
    return RAW_NAMES[raw] ?? `Key ${raw.toString(16).toUpperCase()}`;
  }
  return VK_NAMES[b.code] ?? `Key ${b.code.toString(16).toUpperCase()}`;
}

/** Labels in display order: Ctrl, Alt, Shift, Win/Cmd, then the rest as pressed. */
export function chordLabels(chord: HotkeyChord | null | undefined, platform?: HotkeyPlatform): string[] {
  if (isEmptyChord(chord)) return [];
  return sortButtons(chord!.buttons).map((b) => buttonLabel(b, platform));
}

/** "Ctrl + Shift + M", for tooltips and logs. */
export function chordText(chord: HotkeyChord | null | undefined, platform?: HotkeyPlatform): string {
  return chordLabels(chord, platform).join(" + ");
}
