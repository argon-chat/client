/** The media pipeline owns permission prompts on every supported platform. */
export type MediaPermission = "microphone" | "camera";
export function needsMediaPermissionGate(): boolean { return false; }
export async function isMediaPermissionGranted(_permission: MediaPermission): Promise<boolean> { return true; }
export async function ensureMediaPermission(_permission: MediaPermission): Promise<boolean> { return true; }
