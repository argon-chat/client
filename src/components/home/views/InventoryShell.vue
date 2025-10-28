<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import InventoryView from './InventoryView.vue';
import CoalIcon from "@/assets/icons/inventory/magic_coal.png";
import InventoryItemGranted from './InventoryItemGranted.vue';
import { useApi } from '@/store/apiStore';
import { logger } from '@/lib/logger';
import { InventoryItem, RedeemError } from '@/lib/glue/argonChat';
import itemsData from "@/assets/icons/inventory/items.json";
import { useLocale } from "@/store/localeStore";
import ContextMenu from '@/components/ui/context-menu/ContextMenu.vue';
import ContextMenuTrigger from '@/components/ui/context-menu/ContextMenuTrigger.vue';
import ContextMenuContent from '@/components/ui/context-menu/ContextMenuContent.vue';
import ContextMenuItem from '@/components/ui/context-menu/ContextMenuItem.vue';
const { t } = useLocale();
const effects = import.meta.glob('@/assets/icons/inventory/*.webm', { eager: true, import: 'default' });
const icons = import.meta.glob('@/assets/icons/inventory/*.png', { eager: true, import: 'default' });

export interface ItemDef {
  id: string;
  desc: string;
  name: string;
  class: "common" | "rare" | "legendary" | "relic" | string;
  size: number;
}

export type InventoryItemView = InventoryItem & ItemDef & {
  icon: string;
};

defineOptions({ inheritAttrs: false });

const api = useApi();
const inventory = computed(() => api.inventoryInteraction);

const allItems = ref<InventoryItemView[]>([]);
const itemsByInstanceId = computed(() => new Map(allItems.value.map(i => [i.instanceId, i])));

const grantQueue = ref<InventoryItemView[]>([]);

const open = ref(false);
const openSidebar = ref(false);
const selected = ref<InventoryItemView | null>(null);

function closeSidebar() {
  openSidebar.value = false;
}


const getVideoForItem = (item: InventoryItemView | null) => {
  return effects[`/src/assets/icons/inventory/effect_${item?.class}.webm`] as string;
}
const getIconForItem = (item: ItemDef | null): string => {
  return icons[`/src/assets/icons/inventory/${item?.id}.png`] as string;
}

const rarityClasses = {
  common: "bg-gradient-to-r from-gray-300 via-gray-500 to-gray-200 font-bold bg-clip-text text-transparent",
  rare: "bg-gradient-to-r from-blue-300 via-blue-500 to-blue-200 font-bold bg-clip-text text-transparent",
  legendary: "bg-gradient-to-r from-yellow-300 via-amber-500 to-yellow-200 font-bold bg-clip-text text-transparent",
  relic: "bg-gradient-to-r from-purple-300 via-pink-500 to-red-400 font-bold bg-clip-text text-transparent",
} as Record<string, string>;

const rarityClassesCards = {
  common: "border-gray-500",
  rare: "border-purple-500",
  legendary: "border-red-500",
  relic: "border-yellow-500",
} as Record<string, string>;


onMounted(async () => {
  await reloadData();
});

async function reloadData() {
  const [myItems, notifications] = await Promise.all([
    inventory.value.GetMyInventoryItems(),
    inventory.value.GetNotifications()
  ]);

  allItems.value = myItems.map(it => {
    const meta = (itemsData.items as ItemDef[]).find(x => x.id === it.id);
    return {
      ...it,
      ...(meta ?? { id: it.id, desc: "", name: it.id, class: "", size: 0 }),
      icon: getIconForItem(meta ?? null),
    };
  });

  grantQueue.value = notifications
    .map(n => itemsByInstanceId.value.get(n.inventoryItemId))
    .filter((x): x is InventoryItemView => !!x);

  nextGrant();
}

async function nextGrant() {
  const next = grantQueue.value.shift();
  if (!next) return;
  selected.value = next;
  open.value = true;

  try {
    await inventory.value.MarkSeen([next.instanceId]);
  } catch (e) {
    logger.warn("Failed to mark seen", e, next.instanceId);
  }
}

function onSlotClick(i: number) {
  const item = allItems.value[i];
  if (!item) return;
  selected.value = item;
  openSidebar.value = true;
}

function onGrantedClose() {
  open.value = false;
  requestAnimationFrame(() => nextGrant());
}

function share() {
  // TODO
}

async function onRedeem(code: string) {
  const result = await api.inventoryInteraction.RedeemCode(code);

  if (result.isFailedRedeem()) {
    logger.fail("Redeem failed!", RedeemError[result.error]);
    return;
  }
  logger.success("Redeem ok!");
  await reloadData();
}

async function useItem() {
  openSidebar.value = false;

  try {
    const result = await api.inventoryInteraction.UseItem(selected.value!.instanceId);

    if (result) {
      logger.success("Success use item");
      selected.value = null;
      await reloadData();
    } else {
      logger.fail("failed use item");
    }
  } catch {
    selected.value = null;
  }
}

watch(open, (v) => {
  if (!v && grantQueue.value.length > 0) {
    requestAnimationFrame(() => nextGrant());
  }
});
</script>

<template>
  <InventoryView :title="t('inventory')" :slots="allItems.length" @slot:click="onSlotClick" @redeem="onRedeem"
    :getCardClass="i => allItems[i] ? rarityClassesCards[allItems[i].class] : ''" v-bind="$attrs">
    <template #item="{ index }">
      <div v-if="allItems[index]" class="flex flex-col items-center gap-1 ">
        <img :src="allItems[index].icon" :alt="allItems[index].name" class="w-32 h-32 object-contain"
          draggable="false" />
        <p class="text-xs text-center leading-tight opacity-90 font-bold bg-[length:200%_auto] bg-clip-text text-transparent animate-gold-shine"
          :class="`${rarityClasses[allItems[index].class]}`">
          {{ allItems[index].name }}
        </p>
      </div>
    </template>
  </InventoryView>

  <InventoryItemGranted v-model="open" :item="selected" @primary="onGrantedClose" @secondary="share"
    primary-action="Claim" :getCardClass="i => rarityClasses[i ?? 'rare']" :video-src="getVideoForItem(selected)" />


  <InventoryItemGranted v-model="openSidebar" :item="selected" @primary="useItem()"
    :primary-action="selected?.usable ? 'Use' : undefined" :title="''"
    :getCardClass="i => rarityClasses[i ?? 'rare']" />

</template>

<style scoped>
.animate-gold-shine {
  animation: gold-shine 4s linear infinite;
}

@keyframes gold-shine {
  0% {
    background-position: 200% center;
  }

  100% {
    background-position: -200% center;
  }
}
</style>
