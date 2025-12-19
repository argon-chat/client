export const keyMap: Record<number, string[]> = {
  0x00: ["None"],

  0x01: ["LButton", "LeftButton"],
  0x02: ["RButton", "RightButton"],
  0x03: ["Cancel"],
  0x04: ["MButton"],
  0x05: ["XButton1"],
  0x06: ["XButton2"],

  0x08: ["Back"],
  0x09: ["Tab"],
  0x0a: ["LineFeed"],
  0x0c: ["Clear"],
  0x0d: ["Return", "Enter"],

  0x10: ["Shift"],
  0x11: ["Control", "Ctrl"],
  0x12: ["Menu", "Alt"],
  0x13: ["Pause"],
  0x14: ["Capital", "CapsLock", "Caps"],

  0x15: ["KanaMode", "HanguelMode", "HangulMode"],
  0x17: ["JunjaMode"],
  0x18: ["FinalMode"],
  0x19: ["HanjaMode", "KanjiMode"],

  0x1b: ["Escape"],

  0x1c: ["Convert", "ImeConvert"],
  0x1d: ["NonConvert", "ImeNonConvert"],
  0x1e: ["Accept", "ImeAccept"],
  0x1f: ["ModeChange", "ImeModeChange"],

  0x20: ["Space"],
  0x21: ["Prior", "PageUp"],
  0x22: ["Next", "PageDown"],
  0x23: ["End"],
  0x24: ["Home"],
  0x25: ["Left"],
  0x26: ["Up"],
  0x27: ["Right"],
  0x28: ["Down"],
  0x29: ["Select"],
  0x2a: ["Print"],
  0x2b: ["Execute"],
  0x2c: ["Snapshot", "PrintScreen"],
  0x2d: ["Insert"],
  0x2e: ["Delete"],
  0x2f: ["Help"],

  0x30: ["D0"],
  0x31: ["D1"],
  0x32: ["D2"],
  0x33: ["D3"],
  0x34: ["D4"],
  0x35: ["D5"],
  0x36: ["D6"],
  0x37: ["D7"],
  0x38: ["D8"],
  0x39: ["D9"],

  0x41: ["A"],
  0x42: ["B"],
  0x43: ["C"],
  0x44: ["D"],
  0x45: ["E"],
  0x46: ["F"],
  0x47: ["G"],
  0x48: ["H"],
  0x49: ["I"],
  0x4a: ["J"],
  0x4b: ["K"],
  0x4c: ["L"],
  0x4d: ["M"],
  0x4e: ["N"],
  0x4f: ["O"],
  0x50: ["P"],
  0x51: ["Q"],
  0x52: ["R"],
  0x53: ["S"],
  0x54: ["T"],
  0x55: ["U"],
  0x56: ["V"],
  0x57: ["W"],
  0x58: ["X"],
  0x59: ["Y"],
  0x5a: ["Z"],

  0x5b: ["LWin", "LWindows", "LeftWindows"],
  0x5c: ["RWin", "RWindows", "RightWindows"],
  0x5d: ["Apps"],

  0x5f: ["Sleep"],

  0x60: ["NumPad0"],
  0x61: ["NumPad1"],
  0x62: ["NumPad2"],
  0x63: ["NumPad3"],
  0x64: ["NumPad4"],
  0x65: ["NumPad5"],
  0x66: ["NumPad6"],
  0x67: ["NumPad7"],
  0x68: ["NumPad8"],
  0x69: ["NumPad9"],

  0x6a: ["Multiply"],
  0x6b: ["Add"],
  0x6c: ["Separator"],
  0x6d: ["Subtract"],
  0x6e: ["Decimal"],
  0x6f: ["Divide"],

  0x70: ["F1"],
  0x71: ["F2"],
  0x72: ["F3"],
  0x73: ["F4"],
  0x74: ["F5"],
  0x75: ["F6"],
  0x76: ["F7"],
  0x77: ["F8"],
  0x78: ["F9"],
  0x79: ["F10"],
  0x7a: ["F11"],
  0x7b: ["F12"],
  0x7c: ["F13"],
  0x7d: ["F14"],
  0x7e: ["F15"],
  0x7f: ["F16"],
  0x80: ["F17"],
  0x81: ["F18"],
  0x82: ["F19"],
  0x83: ["F20"],
  0x84: ["F21"],
  0x85: ["F22"],
  0x86: ["F23"],
  0x87: ["F24"],

  0x88: ["NavigationView"],
  0x89: ["NavigationMenu"],
  0x8a: ["NavigationUp"],
  0x8b: ["NavigationDown"],
  0x8c: ["NavigationLeft"],
  0x8d: ["NavigationRight"],
  0x8e: ["NavigationAccept"],
  0x8f: ["NavigationCancel"],

  0x90: ["NumLock"],
  0x91: ["Scroll"],

  0x92: [
    "OemNecEqual",
    "OemFjJisho",
    "OemFjMasshou",
    "OemFjTouroku",
    "OemFjLoya",
    "OemFjRoya",
  ],

  0xa0: ["LShift", "LeftShift"],
  0xa1: ["RShift", "RightShift"],
  0xa2: ["LControl", "LeftControl", "LCtrl", "LeftCtrl"],
  0xa3: ["RControl", "RightControl", "RCtrl", "RightCtrl"],
  0xa4: ["LMenu", "LeftMenu", "LAlt", "LeftAlt"],
  0xa5: ["RMenu", "RightMenu", "RAlt", "RightAlt"],

  0xa6: ["BrowserBack"],
  0xa7: ["BrowserForward"],
  0xa8: ["BrowserRefresh"],
  0xa9: ["BrowserStop"],
  0xaa: ["BrowserSearch"],
  0xab: ["BrowserFavorites"],
  0xac: ["BrowserHome"],

  0xad: ["VolumeMute"],
  0xae: ["VolumeDown"],
  0xaf: ["VolumeUp"],
  0xb0: ["MediaNextTrack"],
  0xb1: ["MediaPreviousTrack"],
  0xb2: ["MediaStop"],
  0xb3: ["MediaPlayPause"],
  0xb4: ["LaunchMail"],
  0xb5: ["SelectMedia"],
  0xb6: ["LaunchApp1", "LaunchApplication1"],
  0xb7: ["LaunchApp2", "LaunchApplication2"],

  0xba: ["Oem1", "OemSemicolon"],
  0xbb: ["OemPlus"],
  0xbc: ["OemComma"],
  0xbd: ["OemMinus"],
  0xbe: ["OemPeriod"],
  0xbf: ["Oem2", "OemQuestion"],
  0xc0: ["Oem3", "OemTilde"],

  0xc3: ["GamepadA"],
  0xc4: ["GamepadB"],
  0xc5: ["GamepadX"],
  0xc6: ["GamepadY"],
  0xc7: ["GamepadRightShoulder"],
  0xc8: ["GamepadLeftShoulder"],
  0xc9: ["GamepadLeftTrigger"],
  0xca: ["GamepadRightTrigger"],
  0xcb: ["GamepadDPadUp"],
  0xcc: ["GamepadDPadDown"],
  0xcd: ["GamepadDPadLeft"],
  0xce: ["GamepadDPadRight"],
  0xcf: ["GamepadMenu"],
  0xd0: ["GamepadView"],
  0xd1: ["GamepadLeftThumbStickButton"],
  0xd2: ["GamepadRightThumbStickButton"],
  0xd3: ["GamepadLeftThumbStickUp"],
  0xd4: ["GamepadLeftThumbStickDown"],
  0xd5: ["GamepadLeftThumbStickRight"],
  0xd6: ["GamepadLeftThumbStickLeft"],
  0xd7: ["GamepadRightThumbStickUp"],
  0xd8: ["GamepadRightThumbStickDown"],
  0xd9: ["GamepadRightThumbStickRight"],
  0xda: ["GamepadRightThumbStickLeft"],

  0xdb: ["Oem4", "OemOpenBrackets"],
  0xdc: ["Oem5", "OemPipe"],
  0xdd: ["Oem6", "OemCloseBrackets"],
  0xde: ["Oem7", "OemQuotes"],
  0xdf: ["Oem8"],

  0xe1: ["OemAx"],
  0xe2: ["Oem102", "OemBackslash"],
  0xe3: ["IcoHelp"],
  0xe4: ["Ico00"],

  0xe5: ["ProcessKey"],
  0xe6: ["IcoClear"],
  0xe7: ["Packet"],

  0xe9: ["OemReset"],
  0xea: ["OemJump"],
  0xeb: ["OemPa1"],
  0xec: ["OemPa2"],
  0xed: ["OemPa3"],
  0xee: ["OemWsCtrl"],
  0xef: ["OemCuSel"],
  0xf0: ["OemAttn"],
  0xf1: ["OemFinish"],
  0xf2: ["OemCopy"],
  0xf3: ["OemAuto"],
  0xf4: ["OemEnLw"],
  0xf5: ["OemBackTab"],

  0xf6: ["Attn"],
  0xf7: ["CrSel"],
  0xf8: ["ExSel"],
  0xf9: ["ErEof", "EraseEof"],
  0xfa: ["Play"],
  0xfb: ["Zoom"],
  0xfc: ["NoName"],
  0xfd: ["Pa1"],
  0xfe: ["OemClear"],

  // MOUSE block
  0x0100: ["MouseNone"],
  0x0101: ["MouseLeft"],
  0x0102: ["MouseRight"],
  0x0103: ["MouseMiddle"],
  0x0104: ["MouseWheel"],
  0x0105: ["MouseXButton1"],
  0x0106: ["MouseXButton2"],
};

export function keyCodeToNames(keyCode: number): string[] {
  const names = keyMap[keyCode];
  if (!names) {
    throw new Error(`Unknown key code: ${keyCode}`);
  }
  return names;
}

const replacement = new Map<string, string>([
  // modifiers
  ["Shift", "⇧"],
  ["LeftShift", "⇧"],
  ["RightShift", "⇧"],

  ["Control", "⌃"],
  ["Ctrl", "⌃"],
  ["LeftControl", "⌃"],
  ["RightControl", "⌃"],
  ["LCtrl", "⌃"],
  ["RCtrl", "⌃"],

  ["Alt", "⎇"], // Windows-safe
  ["Menu", "⎇"],
  ["LeftAlt", "⎇"],
  ["RightAlt", "⎇"],
  ["LAlt", "⎇"],
  ["RAlt", "⎇"],

  ["CapsLock", "⇪"],
  ["Capital", "⇪"],
  ["Caps", "⇪"],

  // system
  ["Enter", "⏎"],
  ["Return", "⏎"],
  ["Escape", "⎋"],
  ["Esc", "⎋"],
  ["Tab", "⇥"],
  ["Back", "⌫"],
  ["Delete", "⌦"],
  ["Insert", "⌤"],
  ["Space", "␣"],

  // navigation
  ["Up", "↑"],
  ["Down", "↓"],
  ["Left", "←"],
  ["Right", "→"],

  ["Home", "⇱"],
  ["End", "⇲"],
  ["PageUp", "⇞"],
  ["PageDown", "⇟"],

  // windows key
  ["LWin", "⊞"],
  ["RWin", "⊞"],
  ["LeftWindows", "⊞"],
  ["RightWindows", "⊞"],

  // mouse
  ["MouseLeft", "🖱₁"],
  ["MouseRight", "🖱₂"],
  ["MouseMiddle", "🖱₃"],
  ["MouseWheel", "⟲"],
]);

function normalizeKeyName(name: string): string {
  return name;
}

export function keyCodeToFormatterSymbolsOrNames(keyCode: number): string {
  const names = keyCodeToNames(keyCode);
  for (const name of names) {
    const symbol = replacement.get(name);
    if (symbol) {
      return symbol;
    }
  }
  return normalizeKeyName(names[0]);
}
