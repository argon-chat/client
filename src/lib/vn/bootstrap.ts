/** Vue-native startup uses SDK services directly; it installs no Electron IPC globals. */
import { isVn } from "./index";
import { applyAtLaunch } from "@/lib/shell/config";
import { startActivityDiagnostics } from "@/lib/shell/activityDiagnostics";
if (isVn) { applyAtLaunch(); startActivityDiagnostics(); }
