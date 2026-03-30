import { ref, onMounted, onUnmounted } from "vue";
import { logger } from "@argon/core";

export function useVersionChecker(intervalMs = 120_000) {
  const needsUpdate = ref(false);
  let timer: number | null = null;
  let currentVersion: string | null = null;
  let initialized = false;

  async function doUpdate() {
    location.reload();
  }

  async function check() {
    try {
      return;
      const res = await fetch("/tag.json", { cache: "no-cache" });
      const data = await res.json();

      if (!initialized) {
        currentVersion = data.version;
        initialized = true;
      } else if (currentVersion !== data.version) {
        needsUpdate.value = true;
      }
    } catch (e) {
      logger.trace("version check failed", e);
    }
  }

  onMounted(() => {
    check();
    //timer = window.setInterval(check, intervalMs);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { needsUpdate, doUpdate };
}
