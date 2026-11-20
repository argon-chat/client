import { onMounted, onUnmounted, shallowRef } from "vue";
import { logger } from "@argon/core";

export interface LogEntry {
  message: string;
  time: string;
}

export function useAppLogger() {
  const logs = shallowRef<LogEntry[]>([]);

  function record(message: string) {
    logs.value = [{ message: message.slice(0, 1000), time: new Date().toLocaleTimeString() }, ...logs.value.slice(0, 19)];
  }

  function describe(value: unknown): string {
    if (value && typeof value === "object" && "message" in value) return String(value.message);
    return String(value);
  }

  const reporter: Parameters<typeof logger.addReporter>[0] = {
    log(entry) {
      if (entry.type === "error" || entry.type === "fail" || entry.type === "fatal") {
        record(entry.args.map(describe).join(" "));
      }
    },
  };
  const onError = (event: ErrorEvent) => { if (event.message) record(event.message); };
  const onRejection = (event: PromiseRejectionEvent) => record(describe(event.reason));

  onMounted(() => {
    logger.addReporter(reporter);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
  });
  onUnmounted(() => {
    logger.removeReporter(reporter);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  });
  return logs;
}
