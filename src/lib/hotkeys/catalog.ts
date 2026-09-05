/**
 * Every action a global hotkey can be bound to.
 *
 * Each action does one fixed thing, so the settings screen is a list of things to do with a key
 * next to each; there is no "mode" to pick and nothing to combine. Push-to-talk is an action of its
 * own rather than "toggle microphone, in hold mode": the pair was the single most confusing thing
 * about the old screen, and its default combination did nothing at all.
 *
 * Ids are persisted; rename one only with a migration in the hotkey store.
 */

export type HotkeyActionId =
  | "voice.pushToTalk"
  | "voice.pushToMute"
  | "voice.toggleMute"
  | "voice.mute"
  | "voice.unmute"
  | "voice.toggleDeafen"
  | "voice.deafen"
  | "voice.undeafen"
  | "call.leave"
  | "call.toggleCamera"
  | "call.stopScreenShare"
  | "app.toggleWindow"
  | "app.openSettings"
  | "overlay.toggle";

export type HotkeyGroupId = "voice" | "call" | "app";

/** "hold" acts on key down and again on key up; "press" acts on key down only. */
export type HotkeyActionKind = "press" | "hold";

export interface HotkeyActionDef {
  id: HotkeyActionId;
  group: HotkeyGroupId;
  kind: HotkeyActionKind;
  /** Locale key of the name. */
  title: string;
  /** Locale key of the one-line explanation. */
  description: string;
  /** Offered only where the feature exists (the in-game overlay is Windows-only and flagged). */
  requires?: "overlay";
}

export interface HotkeyGroupDef {
  id: HotkeyGroupId;
  /** Locale key. */
  title: string;
}

export const HOTKEY_GROUPS: readonly HotkeyGroupDef[] = [
  { id: "voice", title: "hotkeys_group_voice" },
  { id: "call", title: "hotkeys_group_call" },
  { id: "app", title: "hotkeys_group_app" },
];

export const HOTKEY_ACTIONS: readonly HotkeyActionDef[] = [
  {
    id: "voice.pushToTalk",
    group: "voice",
    kind: "hold",
    title: "hotkeys_action_ptt",
    description: "hotkeys_action_ptt_desc",
  },
  {
    id: "voice.pushToMute",
    group: "voice",
    kind: "hold",
    title: "hotkeys_action_push_to_mute",
    description: "hotkeys_action_push_to_mute_desc",
  },
  {
    id: "voice.toggleMute",
    group: "voice",
    kind: "press",
    title: "hotkeys_action_toggle_mute",
    description: "hotkeys_action_toggle_mute_desc",
  },
  {
    id: "voice.mute",
    group: "voice",
    kind: "press",
    title: "hotkeys_action_mute",
    description: "hotkeys_action_mute_desc",
  },
  {
    id: "voice.unmute",
    group: "voice",
    kind: "press",
    title: "hotkeys_action_unmute",
    description: "hotkeys_action_unmute_desc",
  },
  {
    id: "voice.toggleDeafen",
    group: "voice",
    kind: "press",
    title: "hotkeys_action_toggle_deafen",
    description: "hotkeys_action_toggle_deafen_desc",
  },
  {
    id: "voice.deafen",
    group: "voice",
    kind: "press",
    title: "hotkeys_action_deafen",
    description: "hotkeys_action_deafen_desc",
  },
  {
    id: "voice.undeafen",
    group: "voice",
    kind: "press",
    title: "hotkeys_action_undeafen",
    description: "hotkeys_action_undeafen_desc",
  },
  {
    id: "call.leave",
    group: "call",
    kind: "press",
    title: "hotkeys_action_leave_call",
    description: "hotkeys_action_leave_call_desc",
  },
  {
    id: "call.toggleCamera",
    group: "call",
    kind: "press",
    title: "hotkeys_action_toggle_camera",
    description: "hotkeys_action_toggle_camera_desc",
  },
  {
    id: "call.stopScreenShare",
    group: "call",
    kind: "press",
    title: "hotkeys_action_stop_screen_share",
    description: "hotkeys_action_stop_screen_share_desc",
  },
  {
    id: "app.toggleWindow",
    group: "app",
    kind: "press",
    title: "hotkeys_action_toggle_window",
    description: "hotkeys_action_toggle_window_desc",
  },
  {
    id: "app.openSettings",
    group: "app",
    kind: "press",
    title: "hotkeys_action_open_settings",
    description: "hotkeys_action_open_settings_desc",
  },
  {
    id: "overlay.toggle",
    group: "app",
    kind: "press",
    title: "hotkeys_action_toggle_overlay",
    description: "hotkeys_action_toggle_overlay_desc",
    requires: "overlay",
  },
];

const BY_ID: ReadonlyMap<string, HotkeyActionDef> = new Map(HOTKEY_ACTIONS.map((a) => [a.id, a]));

export const HOTKEY_ACTION_IDS: readonly HotkeyActionId[] = HOTKEY_ACTIONS.map((a) => a.id);

export function hotkeyAction(id: string): HotkeyActionDef | undefined {
  return BY_ID.get(id);
}

export function isHotkeyActionId(id: string): id is HotkeyActionId {
  return BY_ID.has(id);
}
