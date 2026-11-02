/**
 * The Electron shell's own config, `HostProc.getConfig` / `setConfigValue`, under vue-native.
 *
 * In Electron this is ArgonApp's NativeConfigStore (desktop `ArgonApp/src/ipc/native-config.ts`). It
 * is a fixed schema of three keys, saved to `userData/app-config.enc`, and main.ts reads it when it
 * creates the window. The C# plugins take their settings from main.ts (`gap_set_config`,
 * `hv_set_config`) and have none of their own here. vue-native has the same schema, saved in
 * localStorage, which vue-native keeps on disk in the app's storage folder. Each key does what the
 * Electron shell does with it:
 *
 * | key                       | type    | default             | what it drives                       |
 * |---------------------------|---------|---------------------|--------------------------------------|
 * | app.DevMode               | Boolean | false               | nothing in the host: the client reads it back (debug panels, dev-only keys) |
 * | appearance.Theme          | String  | "Dark"              | the windows' colour scheme, `appWindow.theme` (Electron's `nativeTheme.themeSource`): Mica's tint and `prefers-color-scheme` |
 * | appearance.WindowMaterial | Enum    | the window's own    | the window's backdrop, `appWindow.backdrop`: acrylic, mica, or solid (`none`) |
 *
 * `requiredToRestartApp` and `onlyForDevMode` are false for all three, as in Electron.
 *
 * Two differences, both on purpose:
 * - Electron's WindowMaterial default is `acrylic`. Here the default is the backdrop the window was
 *   opened with (vn.config.json says `mica`), so `getConfig` reports what is on screen.
 * - Electron applies Theme and WindowMaterial when it creates the window. A live change goes through
 *   `HostProc.setWindowMaterial` and the `argonTheme` bridge, and `setConfigValue` only saves. Here
 *   both keys are applied when this module installs, before the app mounts, and again whenever they
 *   are set. So the Application settings list changes the window too, where Electron would wait for
 *   the next launch.
 *
 * A host too old for `appWindow.theme` still stores Theme. It reports the key back and says once
 * that it cannot apply it.
 */
import {
  ConfigPrimitiveType,
  type ConfigKeyMetadata_Value,
  type ConfigSectionMetadata_Value,
  type SetRequest,
  type SetResult,
} from "@argon/glue/ipc";

interface AppWindowLike {
  backdrop: string;
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
  type: ConfigPrimitiveType;
  defaultB?: boolean;
  defaultStr?: string;
  defaultEnum?: string;
  enumVariants?: string[];
  /** What the host does with the key's value: at install, and on every set. */
  apply?: (value: StoredValue | undefined) => void;
}

const isWindows = navigator.userAgent.includes("Win");

/** WindowMaterial's value for a backdrop name: the inverse of `materialBackdrop`. */
function backdropMaterial(backdrop: string | undefined): string {
  if (backdrop === "mica" || backdrop === "mica-alt" || backdrop === "tabbed") return "mica";
  if (backdrop === "acrylic" || backdrop === "blur") return "acrylic";
  return "solid";
}

/** `appWindow.backdrop` for a WindowMaterial value. `solid` is Electron's `none`. */
function materialBackdrop(material: string): string {
  return material === "acrylic" || material === "mica" ? material : "none";
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
    keys: [{ key: "DevMode", type: ConfigPrimitiveType.Boolean, defaultB: false }],
  },
  {
    section: "appearance",
    keys: [
      {
        key: "Theme",
        type: ConfigPrimitiveType.String,
        defaultStr: "Dark",
        apply: (v) => setWindowTheme(themeSource(v?.s ?? "Dark")),
      },
      {
        key: "WindowMaterial",
        type: ConfigPrimitiveType.Enum,
        defaultEnum: openedMaterial,
        enumVariants: isWindows ? ["acrylic", "mica", "solid"] : ["solid"],
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
function keyToValue(section: string, schema: KeySchema): ConfigKeyMetadata_Value {
  const stored = values()[section]?.[schema.key];
  return {
    key: schema.key,
    type: schema.type,
    requiredToRestartApp: false,
    onlyForDevMode: false,
    valueB: schema.type === ConfigPrimitiveType.Boolean ? (stored?.b ?? schema.defaultB ?? null) : null,
    valueStr: schema.type === ConfigPrimitiveType.String ? (stored?.s ?? schema.defaultStr ?? null) : null,
    valueNum: null,
    valueEnum: schema.type === ConfigPrimitiveType.Enum ? (stored?.e ?? schema.defaultEnum ?? null) : null,
    valueEnumVariants: schema.enumVariants ?? [],
    valueF: null,
  };
}

/** `HostProc.getConfig`. */
export function getConfig(): ConfigSectionMetadata_Value[] {
  return SCHEMA.map((s) => ({ section: s.section, keys: s.keys.map((k) => keyToValue(s.section, k)) }));
}

/**
 * `HostProc.setConfigValue`, with NativeConfigStore's rules. An unknown section or key, or an enum
 * value outside its variants, answers `{ value: null }`, which configStore reports as "Config update
 * failed". A request without a value for the key's type saves an empty entry, so the key reads its
 * default again.
 */
export function setConfigValue(req: SetRequest): SetResult {
  const schema = SCHEMA.find((s) => s.section === req.section)?.keys.find((k) => k.key === req.key);
  if (!schema) return { value: null };
  const stored: StoredValue = {};
  switch (schema.type) {
    case ConfigPrimitiveType.Boolean:
      if (req.valueB != null) stored.b = req.valueB;
      break;
    case ConfigPrimitiveType.String:
      if (req.valueStr != null) stored.s = req.valueStr;
      break;
    case ConfigPrimitiveType.Enum:
      if (req.valueEnum != null) {
        if (schema.enumVariants && !schema.enumVariants.includes(req.valueEnum)) return { value: null };
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
 * `HostProc.setWindowMaterial`, the live switch AppearanceSettings makes before it saves the key.
 * Electron's rules: `acrylic`, `mica` or `none`, and anything else is `none`.
 */
export function setWindowMaterial(material: string): boolean {
  return setBackdrop(material === "acrylic" || material === "mica" ? material : "none");
}

/** What the Electron shell does at window creation: each saved key, or its default, takes effect. */
export function applyAtLaunch(): void {
  for (const s of SCHEMA) {
    for (const k of s.keys) k.apply?.(values()[s.section]?.[k.key]);
  }
}
