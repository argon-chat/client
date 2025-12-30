import { ref } from "vue";
import { logger } from "@/lib/logger";

interface LogEntry {
  message: string;
  type: "info" | "error";
  time: string;
}

export function useAppLogger() {
  const logs = ref<LogEntry[]>([]);

  function logMessage(message: string, type: "info" | "error") {
    logs.value.push({
      message,
      type,
      time: new Date().toLocaleTimeString(),
    });
  }

  function initLogger() {
    logger.addReporter({
      log: (obj, _) => {
        if (obj.type === "error" || obj.type === "fail" || obj.type === "fatal") {
          logMessage(obj.args.join(" "), "error");
        }
      },
    });
  }

  return {
    logs,
    logMessage,
    initLogger,
  };
}
