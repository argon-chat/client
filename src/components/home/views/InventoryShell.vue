<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import InventoryView from './InventoryView.vue';
import CoalIcon from "@/assets/icons/inventory/magic_coal.png";
import InventoryItemGranted from './InventoryItemGranted.vue';
import PurpleEffect from '@/assets/icons/inventory/redEffects.webm';
import { useApi } from '@/store/apiStore';
import { logger } from '@/lib/logger';
import { InventoryItem, RedeemError } from '@/lib/glue/argonChat';
import itemsData from "@/assets/icons/inventory/items.json";

export interface ItemDef {
  id: string;
  desc: string;
  name: string;
  class: string;
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
const selected = ref<InventoryItemView | null>(null);

onMounted(async () => {
  const [myItems, notifications] = await Promise.all([
    inventory.value.GetMyInventoryItems(),
    inventory.value.GetNotifications()
  ]);

  logger.warn("My items:", myItems);
  logger.warn("Unseen notifications:", notifications);

  allItems.value = myItems.map(it => {
    const meta = (itemsData.items as ItemDef[]).find(x => x.id === it.id);
    return {
      ...it,
      ...(meta ?? { id: it.id, desc: "", name: it.id, class: "", size: 0 }),
      icon: CoalIcon,
    };
  });

  grantQueue.value = notifications
    .map(n => itemsByInstanceId.value.get(n.inventoryItemId))
    .filter((x): x is InventoryItemView => !!x);

  nextGrant();
});

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
  open.value = true;
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
}

watch(open, (v) => {
  if (!v && grantQueue.value.length > 0) {
    requestAnimationFrame(() => nextGrant());
  }
});
</script>

<template>
  <InventoryView title="Inventory" :slots="allItems.length" @slot:click="onSlotClick" @redeem="onRedeem"
    v-bind="$attrs">
    <template #item="{ index }">
      <div v-if="allItems[index]" class="flex flex-col items-center gap-1">
        <img :src="allItems[index].icon" :alt="allItems[index].name" class="w-16 h-16 object-contain"
          draggable="false" />
        <p class="text-xs text-center leading-tight opacity-90
                   bg-gradient-to-r from-yellow-300 via-amber-500 to-yellow-200 font-bold
                   bg-[length:200%_auto] bg-clip-text text-transparent animate-gold-shine">
          {{ allItems[index].name }}
        </p>
      </div>
    </template>
  </InventoryView>

  <InventoryItemGranted v-model="open" :item="selected" @close="onGrantedClose" @share="share"
    :video-src="PurpleEffect" />
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
