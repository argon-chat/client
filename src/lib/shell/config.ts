/** Saved application preferences. Theme and backdrop apply through SDK window properties. */
import {
  ConfigValueType,
  type ConfigKey,
  type ConfigSection,
  type ConfigUpdate,
  type ConfigResult,
} from "@/lib/shell/configTypes";

interface AppWindowLike extends Partial<Pick<EventTarget, "addEventListener">> {
  backdrop: string;
  /** What the window draws of `backdrop`; absent on SDKs before macOS fullscreen suspended it. */
  readonly effectiveBackdrop?: string;
  theme?: string;
}

// window.ts reads the same global, for the same reason: the Vite build has no "vue-native" module.
const appWindow = (globalThis as { __VN_WINDOW__?: { appWindow?: AppWindowLike } }).__VN_WINDOW__?.appWindow;

/** Saved values, one per key, in Electron's `StoredValue` shape. */
type StoredValue = { b?: boolean; s?: string; e?: string; n?: string; f?: number };
type StoredConfig = Record<string, Record<string, StoredValue>>;

const STORAGE_KEY = "vn.hostConfig";

interface KeySchema {
  key: string;
  type: ConfigValueType;
  defaultB?: boolean;
  defaultStr?: string;
  defaultEnum?: string;
  enumVariants?: string[];
  /** What the host does with the key's value: at install, and on every set. */
  apply?: (value: StoredValue | undefined) => void;
}

const isWindows = navigator.userAgent.includes("Win");
const isMac = !isWindows && navigator.userAgent.includes("Mac");

/**
 * The materials this platform's window can take, as AppearanceSettings offers them. macOS has one,
 * `glass`: the SDK draws every system backdrop there as the same behind-window blur.
 */
const MATERIALS = isWindows ? ["acrylic", "mica", "solid"] : isMac ? ["glass", "solid"] : ["solid"];

const SYSTEM_BACKDROPS = ["mica", "mica-alt", "tabbed", "acrylic", "blur"];

/** WindowMaterial's value for a backdrop name: the inverse of `materialBackdrop`. */
function backdropMaterial(backdrop: string | undefined): string {
  if (isMac) return backdrop && SYSTEM_BACKDROPS.includes(backdrop) ? "glass" : "solid";
  if (backdrop === "mica" || backdrop === "mica-alt" || backdrop === "tabbed") return "mica";
  if (backdrop === "acrylic" || backdrop === "blur") return "acrylic";
  return "solid";
}

/** `appWindow.backdrop` for a WindowMaterial value. `solid` is Electron's `none`. */
function materialBackdrop(material: string): string {
  if (material === "acrylic" || material === "mica") return material;
  // `acrylic` is the backdrop vn.config.json opens the window with; on macOS it is the glass.
  if (material === "glass" && isMac) return "acrylic";
  return "none";
}

/** Electron's mapping in main.ts `createWindow`: White is light, System follows the OS, the rest is dark. */
function themeSource(theme: string | undefined): "light" | "system" | "dark" {
  return theme === "White" ? "light" : theme === "System" ? "system" : "dark";
}

let themeWarned = false;
function setWindowTheme(source: string): void {
  if (!appWindow) return;
  if (!("theme" in appWindow)) {
    if (!themeWarned) {
      themeWarned = true;
      console.warn("[vue-native] host config appearance.Theme: stored, but this host cannot set the window's colour scheme");
    }
    return;
  }
  appWindow.theme = source;
}

function setBackdrop(backdrop: string): boolean {
  if (!appWindow) return false;
  appWindow.backdrop = backdrop;
  return true;
}

// Read before anything sets it: the backdrop vn.config.json opened the window with.
const openedMaterial = backdropMaterial(appWindow?.backdrop);

const SCHEMA: { section: string; keys: KeySchema[] }[] = [
  {
    section: "app",
    keys: [{ key: "DevMode", type: ConfigValueType.Boolean, defaultB: false }],
  },
  {
    section: "appearance",
    keys: [
      {
        key: "Theme",
        type: ConfigValueType.String,
        defaultStr: "Dark",
        apply: (v) => setWindowTheme(themeSource(v?.s ?? "Dark")),
      },
      {
        key: "WindowMaterial",
        type: ConfigValueType.Enum,
        defaultEnum: openedMaterial,
        enumVariants: MATERIALS,
        // Only a saved value: the default is what the window already shows.
        apply: (v) => {
          if (v?.e !== undefined) setBackdrop(materialBackdrop(v.e));
        },
      },
    ],
  },
];

function load(): StoredConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as StoredConfig) : {};
  } catch (e) {
    console.warn("[vue-native] host config: the saved config could not be read, starting empty", e);
    return {};
  }
}

// Read on first use: ipc.ts imports this module in every build, and only vue-native's calls it.
let saved: StoredConfig | null = null;
const values = (): StoredConfig => (saved ??= load());

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values()));
  } catch (e) {
    console.warn("[vue-native] host config: could not be saved", e);
  }
}

/** NativeConfigStore.keyToValue: the schema merged with the saved value. */
function keyToValue(section: string, schema: KeySchema): ConfigKey {
  const stored = values()[section]?.[schema.key];
  return {
    key: schema.key,
    type: schema.type,
    requiredToRestartApp: false,
    onlyForDevMode: false,
    valueB: schema.type === ConfigValueType.Boolean ? (stored?.b ?? schema.defaultB ?? null) : null,
    valueStr: schema.type === ConfigValueType.String ? (stored?.s ?? schema.defaultStr ?? null) : null,
    valueNum: null,
    valueEnum: schema.type === ConfigValueType.Enum ? (stored?.e ?? schema.defaultEnum ?? null) : null,
    valueEnumVariants: schema.enumVariants ?? [],
    valueF: null,
  };
}

/** Read saved settings with their schema defaults. */
export function getConfig(): ConfigSection[] {
  return SCHEMA.map((s) => ({ section: s.section, keys: s.keys.map((k) => keyToValue(s.section, k)) }));
}

/**
 * Update a saved preference. An unknown section or key, or an enum value outside its variants,
 * answers `{ value: null, error }`, nothing saved or applied; configStore reports the error. A
 * request without a value for the key's type saves an empty entry, so the key reads its default again.
 */
export function setConfigValue(req: ConfigUpdate): ConfigResult {
  const schema = SCHEMA.find((s) => s.section === req.section)?.keys.find((k) => k.key === req.key);
  if (!schema) return { value: null, error: `${req.section}.${req.key} is not a config key` };
  const stored: StoredValue = {};
  switch (schema.type) {
    case ConfigValueType.Boolean:
      if (req.valueB != null) stored.b = req.valueB;
      break;
    case ConfigValueType.String:
      if (req.valueStr != null) stored.s = req.valueStr;
      break;
    case ConfigValueType.Enum:
      if (req.valueEnum != null) {
        if (schema.enumVariants && !schema.enumVariants.includes(req.valueEnum)) {
          return {
            value: null,
            error: `${req.section}.${req.key} cannot be ${JSON.stringify(req.valueEnum)} here; it takes ${schema.enumVariants.join(", ")}`,
          };
        }
        stored.e = req.valueEnum;
      }
      break;
  }
  (values()[req.section] ??= {})[req.key] = stored;
  save();
  schema.apply?.(stored);
  return { value: keyToValue(req.section, schema) };
}

/**
 * Apply a WindowMaterial (acrylic, mica, glass on macOS, or solid) through the SDK window API.
 * `none` is accepted for solid, as Electron's `backgroundMaterial` spells it.
 */
export function setWindowMaterial(material: string): boolean {
  return setBackdrop(materialBackdrop(material));
}

/** Apply saved window preferences at startup. */
export function applyAtLaunch(): void {
  for (const s of SCHEMA) {
    for (const k of s.keys) k.apply?.(values()[s.section]?.[k.key]);
  }
  followEffectiveBackdrop();
}

/**
 * The page is transparent over the window's material. While the SDK draws none of it — a macOS window
 * in fullscreen, whose Space has nothing behind it to blend — `html.backdrop-suspended` gives the page
 * the theme's own background, and drops it again the frame the material returns. Windows keeps its
 * material in fullscreen, so the class never appears there.
 */
function followEffectiveBackdrop(): void {
  const win = appWindow;
  if (!win?.addEventListener) return;
  const sync = () => {
    const drawn = win.effectiveBackdrop;
    document.documentElement.classList.toggle("backdrop-suspended", drawn !== undefined && drawn !== win.backdrop);
  };
  win.addEventListener("backdropchange", sync);
  sync();
}
