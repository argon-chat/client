import { isVn } from "@/lib/vn";
import { shell } from "./host";

export enum ActivityCategory { Game, Music, Hotkeys, System, Network }
export enum DiagnosticLevel { Info, Warn, Error }
export interface ActivityDiagnostic { category: ActivityCategory; logLevel: DiagnosticLevel; template: string; args: string[]; time: number }
const history: ActivityDiagnostic[] = [];
let started = false;
export function startActivityDiagnostics(): void {
  if (started || !isVn || !shell?.activity) return;
  started = true;
  const record = (category: ActivityCategory, template: string, args: string[]) => {
    history.push({ category, logLevel: DiagnosticLevel.Info, template, args, time: Date.now() });
    if (history.length > 1000) history.splice(0, history.length - 1000);
  };
  for (const activity of shell.activity.list()) record(ActivityCategory.Game, "Running application", [activity.name, activity.path]);
  shell.activity.onStarted((activity) => record(ActivityCategory.Game, "Application started", [activity.name, activity.path]));
  shell.activity.onStopped((activity) => record(ActivityCategory.Game, "Application stopped", [activity.name, activity.path]));
  shell.media?.onChanged((track) => record(ActivityCategory.Music, track.isPlaying ? "Media playing" : "Media stopped", [track.title, track.author]));
}
export function activityDiagnostics(category: ActivityCategory, limit: number, offset: number, search: string): ActivityDiagnostic[] {
  startActivityDiagnostics();
  const query = search.toLocaleLowerCase();
  return history.filter((row) => row.category === category && (!query || [row.template, ...row.args].join(" ").toLocaleLowerCase().includes(query)))
    .slice().reverse().slice(offset, offset + limit);
}
