<script setup lang="ts">
import { onMounted, ref, computed, watch, nextTick } from 'vue';
import InventoryView from './InventoryView.vue';
import itemsData from "@/assets/icons/inventory/items.json";
import CoalIcon from "@/assets/icons/inventory/magic_coal.png";
import InventoryItemGranted from './InventoryItemGranted.vue';
import PurpleEffect from '@/assets/icons/inventory/redEffects.webm';
import { useApi } from '@/store/apiStore';
import { logger } from '@/lib/logger';

interface ItemDef { id: string; desc: string; name: string; class: string; size: number; icon: string }
interface MyItem { id: string; grantedDate: { date: Date | string; offsetMinutes: number } }

const STORAGE_KEY = 'seenInventoryItems:v1';

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch (e) {
    logger?.warn?.('Failed to persist seen items', e);
  }
}

const allItems = ref<ItemDef[]>([]);
const itemsById = computed(() => new Map(allItems.value.map(i => [i.id, i])));

const api = useApi();

const seen = ref<Set<string>>(loadSeen());
const grantQueue = ref<ItemDef[]>([]);

const open = ref(false);
const selected = ref<ItemDef | null>(null);

onMounted(async () => {
  allItems.value = itemsData.items.map((i: any) => ({
    ...i,
    icon: CoalIcon,
  }));

  const myItems = await api.userInteraction.GetMyInventoryItems() as MyItem[];
  logger.warn("My items: ", myItems);

  const newIds = myItems.map(x => x.id).filter(id => !seen.value.has(id));

  grantQueue.value = newIds
    .map(id => itemsById.value.get(id))
    .filter((x): x is ItemDef => !!x);
  nextGrant();
});
function nextGrant() {
  const next = grantQueue.value.shift();
  if (!next) return;
  selected.value = next;
  open.value = true;

  seen.value.add(next.id);
  saveSeen(seen.value);
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
}

watch(open, (v) => {
  if (!v && grantQueue.value.length > 0) {
    requestAnimationFrame(() => nextGrant());
  }
});
</script>

<template>
  <InventoryView title="Inventory" :slots="allItems.length" @slot:click="onSlotClick">
    <template #item="{ index }">
      <div v-if="allItems[index]" class="flex flex-col items-center gap-1">
        <img :src="allItems[index].icon" :alt="allItems[index].name" class="w-16 h-16 object-contain" draggable="false" />
        <p class="text-xs text-center leading-tight opacity-90
                   bg-gradient-to-r from-yellow-300 via-amber-500 to-yellow-200 font-bold
                   bg-[length:200%_auto] bg-clip-text text-transparent animate-gold-shine">
          {{ allItems[index].name }}
        </p>
      </div>
    </template>
  </InventoryView>

  <InventoryItemGranted
    v-model="open"
    :item="selected"
    @close="onGrantedClose"
    @share="share"
    :video-src="PurpleEffect"
  />
</template>

<style scoped>
.animate-gold-shine { animation: gold-shine 4s linear infinite; }
@keyframes gold-shine {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}
</style>
