<template>
  <div class="header-list overflow-hidden bg-cover bg-no-repeat bg-center contrast-125 rounded-xl min-h-[8rem]"
    :class="{ 'header-no-bg': !backgroundImage }" :style="backgroundImage ? { backgroundImage } : {}">
    <div class="relative flex flex-col items-start">
      <div class="w-full relative">
        <div class="h-10 header-top-gradient rounded-t-lg" />
        <div class="absolute inset-0 flex items-start pt-1.5">
          <h2 class="text-lg font-bold header-space-name text-shadow-lg px-4 flex items-center gap-2">
            <TooltipProvider v-if="isVerifiedSpace">
              <Tooltip>
                <TooltipTrigger as-child>
                  <span class="relative group">
                    <PhSealCheck
                      class="w-6 h-6 text-yellow-400 cursor-pointer transition-all duration-500 group-hover:rotate-[360deg] group-hover:scale-110 group-hover:drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                      weight="fill" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" class="bg-gray-900 text-white px-2 py-1 rounded text-sm">
                  Verified Space!
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {{ spaceName?.name }}
          </h2>
        </div>
      </div>
    </div>

    <!-- Boost mini-banner -->
    <div v-if="spaceName" class="boost-strip">
      <div class="boost-strip-inner">
        <RocketIcon class="w-3.5 h-3.5 text-violet-300" />
        <div class="boost-strip-bar">
          <div class="boost-strip-bar-fill" :style="{ width: boostProgressPercent + '%' }" />
        </div>
        <span class="boost-strip-count">{{ spaceName.boostCount }}</span>
        <button class="boost-strip-btn" ref="boostBtnRef" :disabled="boosting" @click="handleBoostClick">
          <Loader2 v-if="boosting" class="w-3 h-3 animate-spin" />
          <RocketIcon v-else class="w-3 h-3" />
          Boost
        </button>
      </div>
    </div>

    <BoostShopModal v-model:open="shopOpen" @purchased="onBoostPurchased" />
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from "vue";
import { delay } from "@argon/core";
import { usePoolStore } from "@/store/data/poolStore";
import { cdnUrl } from "@/store/system/fileStorage";
import { PhSealCheck } from "@phosphor-icons/vue";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@argon/ui/tooltip";
import { RocketIcon, Loader2 } from "lucide-vue-next";
import confetti from "@/lib/useConfetti";
import { useUltimaStore } from "@/store/data/ultimaStore";
import { useToast } from "@argon/ui/toast";
import BoostShopModal from "@/components/modals/BoostShopModal.vue";
import type { Guid } from "@argon-chat/ion.webcore";
import { useLiveQuery } from "@/composables/useLiveQuery";
import { db } from "@/store/db/dexie";

const pool = usePoolStore();
const ultima = useUltimaStore();
const { toast } = useToast();

const selectedSpaceId = defineModel<string>('selectedSpace', {
  type: String, required: true
});

const isVerifiedSpace = computed(() => {
  return selectedSpaceId.value === "11111111-0000-1111-1111-111111111112";
})

const spaceName = useLiveQuery(() => db.servers.where("spaceId").equals(selectedSpaceId.value).first())

const headerImageUrl = ref<string | null>(null);
const isLoadingHeader = ref(false);
const boostBtnRef = ref<HTMLButtonElement | null>(null);
const boosting = ref(false);
const shopOpen = ref(false);

// Boost level thresholds
const levelThresholds = [0, 2, 7, 14];

const boostProgressPercent = computed(() => {
  if (!spaceName.value) return 0;
  const level = spaceName.value.boostLevel;
  const count = spaceName.value.boostCount;
  const currentThreshold = levelThresholds[level] ?? 0;
  const nextThreshold = levelThresholds[level + 1];
  if (!nextThreshold) return 100;
  const progress = (count - currentThreshold) / (nextThreshold - currentThreshold);
  return Math.min(Math.max(progress * 100, 0), 100);
});

function fireConfetti() {
  if (boostBtnRef.value) {
    const rect = boostBtnRef.value.getBoundingClientRect();
    const x = (rect.left + rect.width / 2) / window.innerWidth;
    const y = (rect.top + rect.height / 2) / window.innerHeight;
    const colors = ['#8b5cf6', '#c084fc', '#a78bfa', '#e879f9', '#7c3aed'];
    const base = { origin: { x, y }, colors, ticks: 120, scalar: 0.8, particleCount: 15, spread: 40 };

    // Up
    confetti({ ...base, angle: 270, gravity: 1.5 });
    // Right
    setTimeout(() => confetti({ ...base, angle: 0, gravity: 0.8 }), 80);
    // Down
    setTimeout(() => confetti({ ...base, angle: 90, gravity: 0.3 }), 160);
    // Left
    setTimeout(() => confetti({ ...base, angle: 180, gravity: 0.8 }), 240);
  }
}

async function handleBoostClick() {
  if (boosting.value) return;

  // Check if there are unassigned boosts available
  const unassigned = ultima.unassignedBoosts;
  if (unassigned.length === 0) {
    // No boosts available — open shop modal
    shopOpen.value = true;
    return;
  }

  // Apply the first unassigned boost to this space
  boosting.value = true;
  try {
    const boostId = unassigned[0].boostId;
    const spaceId = selectedSpaceId.value as Guid;
    const result = await ultima.applyBoost(boostId, spaceId);
    if (result.success) {
      fireConfetti();
      toast({ title: "Boost applied!" });
    } else {
      toast({ title: "Boost failed", variant: "destructive" });
    }
  } finally {
    boosting.value = false;
  }
}

function onBoostPurchased() {
  // Refresh boosts after purchase
  ultima.fetchBoosts();
}

const backgroundImage = computed(() => {
  if (headerImageUrl.value) {
    return `url(${headerImageUrl.value})`;
  }
  return '';
});

const loadHeaderImage = async () => {
  if (!selectedSpaceId.value) {
    headerImageUrl.value = null;
    return;
  }

  const space = await pool.getServer(selectedSpaceId.value);
  if (!space?.topBannerFileId) {
    headerImageUrl.value = null;
    return;
  }

  try {
    isLoadingHeader.value = true;
    headerImageUrl.value = cdnUrl(space.topBannerFileId);
  } catch (error) {
    console.error("Failed to load header image:", error);
    headerImageUrl.value = null;
  } finally {
    isLoadingHeader.value = false;
  }
};

watch(selectedSpaceId, () => {
  loadHeaderImage();
}, { immediate: true });

// Watch for space details updates
watch(() => spaceName.value, async (newSpace, oldSpace) => {
  if (newSpace && oldSpace && newSpace.topBannerFileId !== oldSpace.topBannerFileId) {
    await loadHeaderImage();
  }
}, { deep: true });

onMounted(async () => {
  await delay(1000);
  await loadHeaderImage();
});
</script>

<style scoped>
.boost-strip {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 0.3rem 0.625rem;
  background: linear-gradient(to top, hsl(270 40% 8% / 0.9), hsl(270 30% 10% / 0.6));
  backdrop-filter: blur(6px);
}

.boost-strip-inner {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.boost-strip-bar {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: hsl(270 20% 25% / 0.5);
  overflow: hidden;
}

.boost-strip-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, hsl(270 70% 60%), hsl(290 65% 55%));
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.boost-strip-count {
  font-size: 0.625rem;
  font-weight: 700;
  color: hsl(270 70% 75%);
  min-width: 1rem;
  text-align: center;
}

.boost-strip-btn {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.2rem 0.5rem;
  border-radius: 0.375rem;
  border: none;
  font-size: 0.625rem;
  font-weight: 700;
  color: white;
  background: linear-gradient(135deg, hsl(270 65% 45%), hsl(290 55% 40%));
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 1px 4px hsl(270 60% 30% / 0.4);
}

.boost-strip-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 8px hsl(270 60% 30% / 0.5);
  background: linear-gradient(135deg, hsl(270 70% 50%), hsl(290 60% 45%));
}

.header-list {
  position: relative;
}

/* ── Light theme overrides ── */
:root:not(.dark) .boost-strip {
  background: linear-gradient(to top, hsl(270 30% 95% / 0.95), hsl(270 20% 97% / 0.8));
}

:root:not(.dark) .boost-strip-bar {
  background: hsl(270 20% 85%);
}

:root:not(.dark) .boost-strip-count {
  color: hsl(270 60% 45%);
}

:root:not(.dark) .boost-strip-btn {
  box-shadow: 0 1px 4px hsl(270 60% 50% / 0.2);
}

.header-no-bg {
  background-color: #16161655;
}

:root:not(.dark) .header-no-bg {
  background-color: hsl(270 20% 92%);
}

.header-top-gradient {
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.8), transparent);
}

:root:not(.dark) .header-top-gradient {
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.4), transparent);
}

.header-space-name {
  color: white;
}
</style>
