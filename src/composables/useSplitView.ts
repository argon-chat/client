import { ref, computed } from "vue";
import { persistedValue } from "@argon/storage";
import { useFeatureFlags, FeatureFlagKeys } from "@/store/features/featureFlagsStore";

/**
 * Split (dual-pane) view: a secondary channel rendered beside the primary one.
 * Secondary state lives here (it isn't route-driven). The open trigger is
 * configurable via `appearance.splitTrigger`.
 *
 *   off        — feature disabled
 *   ctrlclick  — Ctrl/Cmd-click or middle-click a channel
 *   button     — hover "open in split" button + context-menu item
 *   both       — all of the above
 */
export type SplitTrigger = "off" | "ctrlclick" | "button" | "both";

export const splitTrigger = persistedValue<string>("appearance.splitTrigger", "ctrlclick");

export const splitOpen = ref(false);
export const secondaryChannelId = ref<string | null>(null);
export const secondarySpaceId = ref<string | null>(null);

// Server feature flag — the whole feature is off unless this is enabled.
export const splitFeatureEnabled = computed(() => {
  try {
    return useFeatureFlags().isEnabled(FeatureFlagKeys.SPLIT_VIEW_ACTIVE);
  } catch {
    return false; // pinia not ready yet
  }
});

export const splitEnabled = computed(
  () => splitFeatureEnabled.value && splitTrigger.value !== "off",
);
export const canCtrlClick = computed(
  () => splitEnabled.value && (splitTrigger.value === "ctrlclick" || splitTrigger.value === "both"),
);
export const canButton = computed(
  () => splitEnabled.value && (splitTrigger.value === "button" || splitTrigger.value === "both"),
);

export function openInSplit(channelId: string, spaceId: string | null) {
  if (!splitEnabled.value || !channelId) return;
  secondaryChannelId.value = channelId;
  secondarySpaceId.value = spaceId;
  splitOpen.value = true;
}

export function closeSplit() {
  splitOpen.value = false;
  secondaryChannelId.value = null;
  secondarySpaceId.value = null;
}
