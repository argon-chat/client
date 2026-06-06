<template>
  <div class="text-white space-y-6 game-overlay-settings">
    <div>
      <h2 class="text-2xl font-bold">Game Overlay</h2>
      <p class="text-sm text-muted-foreground">
        Show your voice channel over games, and control what activity is shared with friends.
      </p>
    </div>

    <!-- ── Global settings ── -->
    <div class="space-y-5 setting-card">
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="font-medium">In-game overlay</div>
          <div class="text-xs text-muted-foreground">Show voice members on the game's screen while you're in a call.</div>
        </div>
        <Switch v-model:checked="settings.overlayEnabled" />
      </div>

      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="font-medium">Share game activity</div>
          <div class="text-xs text-muted-foreground">Broadcast “Playing …” to your friends.</div>
        </div>
        <Switch v-model:checked="settings.activityPublishEnabled" />
      </div>

      <div class="border-t border-white/10 pt-4 space-y-5" :class="dimWhenOverlayOff">
        <!-- Opacity -->
        <div class="space-y-2">
          <div class="flex justify-between text-sm">
            <span>Opacity</span>
            <span class="text-muted-foreground">{{ Math.round(settings.overlayOpacity * 100) }}%</span>
          </div>
          <Slider :min="0.1" :max="1" :step="0.05" v-model="opacityArray" />
        </div>

        <!-- Position -->
        <div class="space-y-2">
          <label class="text-sm">Position</label>
          <Select v-model="settings.overlayAnchor">
            <SelectTrigger class="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="a in anchors" :key="a.value" :value="a.value">{{ a.label }}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- Edge padding -->
        <div class="space-y-2">
          <div class="flex justify-between text-sm">
            <span>Edge padding</span>
            <span class="text-muted-foreground">{{ settings.overlayScreenPadding }}px</span>
          </div>
          <Slider :min="0" :max="120" :step="2" v-model="paddingArray" />
        </div>
      </div>
    </div>

    <!-- ── Registered games journal ── -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold">Registered games</h3>
        <span class="text-xs text-muted-foreground">{{ settings.gamesList.length }} tracked</span>
      </div>
      <p class="text-xs text-muted-foreground">
        Games detected while running. Toggle the overlay or activity sharing per game.
      </p>

      <div
        v-if="settings.gamesList.length === 0"
        class="text-sm text-muted-foreground rounded-lg border border-dashed p-6 text-center"
      >
        No games detected yet — launch a game and it'll show up here.
      </div>

      <div v-for="g in settings.gamesList" :key="g.id" class="game-card">
        <div class="flex items-center gap-3">
          <div class="game-icon">
            <img v-if="g.icon" :src="g.icon" alt="" class="w-full h-full object-contain" />
            <Gamepad2 v-else class="w-5 h-5 text-muted-foreground" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="font-medium truncate flex items-center gap-2">
              <span class="truncate">{{ g.name }}</span>
              <Badge v-if="!g.supportsOverlay" variant="secondary" class="text-[10px] shrink-0 gap-1 px-1.5">
                <TriangleAlert class="w-3 h-3" /> No overlay
              </Badge>
            </div>
            <div class="text-[11px] text-muted-foreground">Last seen {{ formatLastSeen(g.lastSeen) }}</div>
          </div>

          <!-- Inline control group: overlay / activity toggles + remove -->
          <TooltipProvider :delayDuration="250" :ignoreNonKeyboardFocus="true">
            <div class="flex items-center gap-1">
              <div class="flex items-center rounded-lg bg-black/20 p-0.5">
                <Tooltip>
                  <TooltipTrigger
                    :class="['ctl-chip', g.overlayEnabled && 'ctl-on-overlay']"
                    @click="settings.setGameOverlay(g.id, !g.overlayEnabled)"
                  >
                    <Monitor class="w-4 h-4" />
                  </TooltipTrigger>
                  <TooltipContent>Overlay — {{ g.overlayEnabled ? "on" : "off" }}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    :class="['ctl-chip', g.activityPublish && 'ctl-on-activity']"
                    @click="settings.setGameActivity(g.id, !g.activityPublish)"
                  >
                    <Radio class="w-4 h-4" />
                  </TooltipTrigger>
                  <TooltipContent>Share activity — {{ g.activityPublish ? "on" : "off" }}</TooltipContent>
                </Tooltip>
              </div>
              <Tooltip>
                <TooltipTrigger class="ctl-chip hover:!text-red-400" @click="settings.removeGame(g.id)">
                  <X class="w-4 h-4" />
                </TooltipTrigger>
                <TooltipContent>Remove from list</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>

        <div v-if="!g.supportsOverlay" class="mt-2 flex items-start gap-1.5 text-[11px] text-amber-400/90">
          <TriangleAlert class="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>Runs in exclusive fullscreen — overlays can't show over it. Switch the game to
            borderless/windowed mode to use the overlay.</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Switch } from "@argon/ui/switch";
import { Slider } from "@argon/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@argon/ui/select";
import { Badge } from "@argon/ui/badge";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@argon/ui/tooltip";
import { Gamepad2, Monitor, Radio, TriangleAlert, X } from "lucide-vue-next";
import { useGameOverlaySettings } from "@/store/features/gameOverlaySettingsStore";
import type { WidgetAnchor } from "@/lib/overlay";

const settings = useGameOverlaySettings();

const anchors: { value: WidgetAnchor; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

// Sliders bind to a number[] — bridge to the single persisted values.
const opacityArray = computed<number[]>({
  get: () => [settings.overlayOpacity],
  set: (v) => { settings.overlayOpacity = v[0] ?? settings.overlayOpacity; },
});
const paddingArray = computed<number[]>({
  get: () => [settings.overlayScreenPadding],
  set: (v) => { settings.overlayScreenPadding = Math.round(v[0] ?? settings.overlayScreenPadding); },
});

const dimWhenOverlayOff = computed(() =>
  settings.overlayEnabled ? "" : "opacity-50 pointer-events-none",
);

function formatLastSeen(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}
</script>

<style scoped>
.game-overlay-settings {
  @apply max-w-5xl mx-auto;
}

.setting-card {
  @apply rounded-xl border bg-card p-6 shadow-sm;
}

.game-card {
  @apply rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md;
}

.game-icon {
  @apply w-10 h-10 rounded-lg bg-black/30 flex items-center justify-center overflow-hidden shrink-0;
}

/* Compact icon toggle — muted when off, tinted + colored when pressed/on. */
.ctl-chip {
  @apply flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground/50
         transition-colors hover:text-foreground hover:bg-white/5
         focus-visible:outline-none;
}

.ctl-on-overlay {
  @apply text-primary bg-primary/15 hover:text-primary;
}

.ctl-on-activity {
  @apply text-emerald-400 bg-emerald-400/15 hover:text-emerald-400;
}
</style>
