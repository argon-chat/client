import { ref, onMounted, onUnmounted, computed } from "vue";
import { logger } from "@argon/core";

const UPDATE_CHECK_URL = "https://updates.argon.gl/runtime/core-linux/latest.linux";
const DOWNLOAD_BASE_URL = "https://updates.argon.gl";
const CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes

export function useLinuxUpdateChecker() {
  const isLinux = navigator.userAgent.includes("Linux") && !navigator.userAgent.includes("Android");
  const latestVersion = ref<string | null>(null);
  const latestDebPath = ref<string | null>(null);
  const hasUpdate = ref(false);
  const showModal = ref(false);

  let timer: ReturnType<typeof setInterval> | null = null;

  const currentVersion = computed(() => {
    return (window as any).argon_host_version_full as string | undefined;
  });

  const downloadUrl = computed(() => {
    if (!latestDebPath.value) return null;
    return `${DOWNLOAD_BASE_URL}/${latestDebPath.value}`;
  });

  const downloadCommand = computed(() => {
    if (!downloadUrl.value) return null;
    return `curl -fSL -o /tmp/argon-desktop.deb "${downloadUrl.value}" && sudo dpkg -i /tmp/argon-desktop.deb`;
  });

  function extractVersion(debPath: string): string | null {
    // path format: runtime/core-linux/{version}/argon-desktop.deb
    const match = debPath.match(/runtime\/core-linux\/([^/]+)\//);
    return match?.[1] ?? null;
  }

  async function check() {
    if (!isLinux) return;

    logger.log("Checking for Linux updates...");

    try {
      const res = await fetch(UPDATE_CHECK_URL, { cache: "no-cache" });
      if (!res.ok) {
        logger.warn(`Linux update check failed: ${res.status} ${res.statusText}`);
        return;
      }

      const text = (await res.text()).trim();
      if (!text) {
        logger.warn("Linux update check returned empty response");
        return;
      }

      latestDebPath.value = text;
      const remoteVersion = extractVersion(text);
      if (!remoteVersion) {
        logger.warn(`Failed to extract version from deb path: ${text}`);
        return;
      }

      logger.log(`Latest Linux version: ${remoteVersion} != ${currentVersion.value}`);

      latestVersion.value = remoteVersion;

      const local = currentVersion.value;
      if (local && local !== remoteVersion) {
        hasUpdate.value = true;
        logger.info(`Linux update available: ${local} → ${remoteVersion}`);
      }
    } catch (e) {
      logger.log("Linux update check failed", e);
    }
  }

  onMounted(() => {
    if (!isLinux) return;
    check();
    timer = setInterval(check, CHECK_INTERVAL);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return {
    isLinux,
    hasUpdate,
    latestVersion,
    downloadUrl,
    downloadCommand,
    showModal,
    currentVersion,
  };
}
