/** Skathi startup uses SDK services directly; it installs no Electron IPC globals. */
import { isSk } from "./index";
import { applyAtLaunch } from "@/lib/shell/config";
import { startActivityDiagnostics } from "@/lib/shell/activityDiagnostics";
import { startTray } from "./tray";
if (isSk) { applyAtLaunch(); startActivityDiagnostics(); startTray(); }
