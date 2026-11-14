import { ref, onMounted, onUnmounted, computed } from "vue";
import { logger } from "@argon/core";
import { isSk } from "@/lib/sk";
import { shell, type UpdateStatus } from "@/lib/shell/host";

const UPDATE_CHECK_URL = "https://updates.argon.gl/runtime/core-linux/latest.linux";
const DOWNLOAD_BASE_URL = "https://updates.argon.gl";
const CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes

/**
 * Linux updates. The native app is an AppImage that updates itself (`argon.update`): this only
 * offers the restart once the new version is in place. Elsewhere on Linux (the older .deb desktop
 * app) it checks the .deb channel and offers the install command.
 */
export function useLinuxUpdateChecker() {
  const isLinux = navigator.userAgent.includes("Linux") && !navigator.userAgent.includes("Android");
  const native = isSk && !!shell.update;
  const nativeStatus = ref<UpdateStatus | null>(null);
  const latestVersion = ref<string | null>(null);
  const latestDebPath = ref<string | null>(null);
  const debUpdate = ref(false);
  const showModal = ref(false);

  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const currentVersion = computed(() => {
    return isSk ? shell.system.info().appVersion : undefined;
  });

  const hasUpdate = computed(() => (native ? nativeStatus.value?.phase === "ready" : debUpdate.value));

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
        debUpdate.value = true;
        logger.info(`Linux update available: ${local} → ${remoteVersion}`);
      }
    } catch (e) {
      logger.log("Linux update check failed", e);
    }
  }

  function onNativeStatus(status: UpdateStatus) {
    nativeStatus.value = status;
    if (status.phase === "ready") latestVersion.value = status.version ?? null;
    if (status.phase === "failed") logger.warn(`Update failed: ${status.error}`);
  }

  /** The update button: restart into the new version, or show how to install the .deb. */
  function apply() {
    if (!native) {
      showModal.value = true;
      return;
    }
    if (!shell.update!.restart()) logger.warn("No update is ready to restart into");
  }

  onMounted(() => {
    if (native) {
      const update = shell.update!;
      onNativeStatus(update.state());
      unsubscribe = update.onChanged(onNativeStatus);
      return;
    }
    if (isSk || !isLinux) return;
    check();
    timer = setInterval(check, CHECK_INTERVAL);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
    unsubscribe?.();
  });

  return {
    isLinux,
    native,
    hasUpdate,
    latestVersion,
    downloadUrl,
    downloadCommand,
    showModal,
    currentVersion,
    apply,
  };
}
