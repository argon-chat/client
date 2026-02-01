<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import InventoryView from './InventoryView.vue';
import InventoryItemGranted from './InventoryItemGranted.vue';
import { useApi } from '@/store/apiStore';
import { logger } from '@argon/core';
import { InventoryItem, RedeemError } from '@argon/glue';
import { type ItemDef, type ItemQuality, itemsById, getItemIcon, rarityClasses, rarityClassesCards, rarities, allItems } from "@argon/inventory";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@argon/ui/context-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@argon/ui/tooltip';
import { IconFilter, IconSortAscending, IconSparkles } from '@tabler/icons-vue';
import { useConfigStore } from '@/store/configStore';
import { Button } from '@argon/ui/button';
import { useLocale } from '@/store/localeStore';
import { useToast } from '@argon/ui/toast';
import { useNotifications } from '@/composables/useNotifications';

export type InventoryItemView = InventoryItem & ItemDef & {
  icon: string;
};

defineOptions({ inheritAttrs: false });

const { t } = useLocale();
const api = useApi();
const inventory = computed(() => api.inventoryInteraction);
const toast = useToast();
const notificationsStore = useNotifications();

const configStore = useConfigStore();
const isDevMode = computed(() => {
  if (!argon.isArgonHost) return true;
  return configStore.devModeEnabled;
});

const myInventoryItems = ref<InventoryItemView[]>([]);
const itemsByInstanceId = computed(() => new Map(myInventoryItems.value.map(i => [i.instanceId, i])));

const grantQueue = ref<InventoryItemView[]>([]);
const loading = ref(true);
const initialSlots = 12;

const open = ref(false);
const openSidebar = ref(false);
const selected = ref<InventoryItemView | null>(null);

// Filters and sorting
const selectedRarity = ref<string | null>(null);
const sortBy = ref<'name' | 'rarity' | 'recent'>('recent');

const filteredItems = computed(() => {
  let items = [...myInventoryItems.value];
  
  // Apply rarity filter
  if (selectedRarity.value) {
    items = items.filter(item => item.class === selectedRarity.value);
  }
  
  // Apply sorting
  switch (sortBy.value) {
    case 'name':
      items.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'rarity':
      const rarityOrder = { common: 0, rare: 1, legendary: 2, relic: 3 };
      items.sort((a, b) => (rarityOrder[b.class as keyof typeof rarityOrder] || 0) - (rarityOrder[a.class as keyof typeof rarityOrder] || 0));
      break;
    case 'recent':
    default:
      // Keep original order (most recent first)
      break;
  }
  
  return items;
});

onMounted(async () => {
  await reloadData();
});

async function reloadData() {
  loading.value = true;
  try {
    const [myItems, notifications] = await Promise.all([
      inventory.value.GetMyInventoryItems(),
      inventory.value.GetNotifications()
    ]);

    myInventoryItems.value = myItems.map(it => {
      const meta = itemsById[it.id];
      const baseItem = {
        ...it,
        ...(meta ?? { id: it.id, desc: "", name: it.id, class: "common" as ItemQuality, size: 0 }),
        icon: meta ? (getItemIcon(meta.id) ?? '') : '',
      };
      
      // Translate name and desc using locale keys
      if (meta) {
        baseItem.name = t(meta.name);
        baseItem.desc = t(meta.desc);
      }
      
      return baseItem;
    });

    grantQueue.value = notifications
      .map(n => itemsByInstanceId.value.get(n.inventoryItemId))
      .filter((x): x is InventoryItemView => !!x);

    nextGrant();
    
    // Refresh notifications count after loading inventory data
    await notificationsStore.loadNotifications();
  } finally {
    loading.value = false;
  }
}

async function nextGrant() {
  const next = grantQueue.value.shift();
  if (!next) return;
  selected.value = next;
  open.value = true;

  if (next.instanceId.startsWith("debug-")) return;

  try {
    await notificationsStore.markInventoryItemSeen(next.instanceId);
  } catch (e) {
    logger.warn("Failed to mark seen", e, next.instanceId);
  }
}

function onSlotClick(i: number) {
  const item = filteredItems.value[i];
  if (!item) return;
  selected.value = item;
  openSidebar.value = true;
}

function onGrantedClose() {
  // Mark the item as seen in notifications
  if (selected.value && !selected.value.instanceId.startsWith("debug-")) {
    notificationsStore.markInventoryItemSeen(selected.value.instanceId);
  }
  
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
    toast.toast({
      title: t('inventory_redeem_failed'),
      description: t(`inventory_redeem_error_${RedeemError[result.error].toLowerCase()}`, RedeemError[result.error]),
      variant: "destructive",
      duration: 4500,
    });
    return;
  }
  logger.success("Redeem ok!");
  toast.toast({
    title: t('inventory_redeem_success'),
    description: t('inventory_redeem_success_desc'),
    variant: "default",
    duration: 3000,
  });
  await reloadData();
}

async function useItem() {
  openSidebar.value = false;
  const itemName = selected.value?.name || 'item';

  try {
    const result = await api.inventoryInteraction.UseItem(selected.value!.instanceId);

    if (result) {
      logger.success("Item used successfully");
      toast.toast({
        title: t('inventory_use_success'),
        description: t('inventory_use_success_desc', { item: itemName }),
        variant: "default",
        duration: 3000,
      });
      selected.value = null;
      await reloadData();
    } else {
      logger.fail("Failed to use item");
      toast.toast({
        title: t('inventory_use_failed'),
        description: t('inventory_use_failed_desc', { item: itemName }),
        variant: "destructive",
        duration: 4500,
      });
    }
  } catch (error) {
    logger.fail("Error using item", error);
    toast.toast({
      title: t('inventory_use_error'),
      description: t('inventory_use_error_desc', { error: String(error) }),
      variant: "destructive",
      duration: 4500,
    });
    selected.value = null;
  }
}

watch(open, (v) => {
  if (!v && grantQueue.value.length > 0) {
    requestAnimationFrame(() => nextGrant());
  }
});

// Debug function to test item grant effects
function debugGrantTestItem() {
  const randomItem = allItems[Math.floor(Math.random() * allItems.length)];
  const testItem: InventoryItemView = {
    instanceId: `debug-${Date.now()}`,
    giftable: true,
    usable: false,
    grantedDate: { date: new Date(), offsetMinutes: 0 },
    usableVector: null,
    receivedFrom: null,
    ttl: null,
    icon: getItemIcon(randomItem.id) ?? '',
    ...randomItem,
    // Translate name and desc for test items
    name: t(randomItem.name),
    desc: t(randomItem.desc),
  };
  
  grantQueue.value.push(testItem);
  if (!open.value) {
    nextGrant();
  }
}

</script>

<template>
  <InventoryView 
    :title="t('inventory')" 
    :slots="loading ? initialSlots : filteredItems.length" 
    :item-count="loading ? undefined : filteredItems.length"
    :loading="loading"
    :has-item="(i) => !!filteredItems[i]"
    @slot:click="onSlotClick" 
    @redeem="onRedeem"
    :getCardClass="i => filteredItems[i] ? rarityClassesCards[filteredItems[i].class] : ''" 
    v-bind="$attrs"
  >
    <template #actions>
      <!-- Debug button (dev mode only) -->
      <Button 
        v-if="isDevMode" 
        size="sm" 
        variant="outline"
        class="gap-2 border-amber-500/50 hover:border-amber-500 hover:bg-amber-500/10"
        @click="debugGrantTestItem"
      >
        <IconSparkles class="w-4 h-4" />
        {{ t('inventory_test_grant') }}
      </Button>
      
      <!-- Rarity Filter Dropdown -->
      <ContextMenu>
        <ContextMenuTrigger as-child>
          <button class="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors">
            <IconFilter class="w-4 h-4" />
            <span class="text-sm font-medium">
              {{ selectedRarity ? selectedRarity.charAt(0).toUpperCase() + selectedRarity.slice(1) : t('inventory_filter_all') }}
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem @click="selectedRarity = null">
            <span :class="!selectedRarity ? 'font-bold' : ''">{{ t('inventory_filter_all_items') }}</span>
          </ContextMenuItem>
          <ContextMenuItem 
            v-for="rarity in rarities" 
            :key="rarity"
            @click="selectedRarity = rarity"
          >
            <span :class="[rarityClasses[rarity], selectedRarity === rarity ? 'font-bold' : '']">
              {{ rarity.charAt(0).toUpperCase() + rarity.slice(1) }}
            </span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <!-- Sort Dropdown -->
      <ContextMenu>
        <ContextMenuTrigger as-child>
          <button class="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors">
            <IconSortAscending class="w-4 h-4" />
            <span class="text-sm font-medium">
              {{ sortBy === 'name' ? t('inventory_sort_name') : sortBy === 'rarity' ? t('inventory_sort_rarity') : t('inventory_recent') }}
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem @click="sortBy = 'recent'">
            <span :class="sortBy === 'recent' ? 'font-bold' : ''">{{ t('inventory_sort_recent') }}</span>
          </ContextMenuItem>
          <ContextMenuItem @click="sortBy = 'name'">
            <span :class="sortBy === 'name' ? 'font-bold' : ''">{{ t('inventory_sort_name') }}</span>
          </ContextMenuItem>
          <ContextMenuItem @click="sortBy = 'rarity'">
            <span :class="sortBy === 'rarity' ? 'font-bold' : ''">{{ t('inventory_sort_rarity') }}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </template>

    <template #item="{ index }">
      <TooltipProvider v-if="filteredItems[index]">
        <Tooltip :delay-duration="300">
          <TooltipTrigger as-child>
            <div class="relative flex flex-col items-center gap-2 w-full h-full p-2">
              <!-- Usable indicator -->
              <div v-if="filteredItems[index].usable" 
                class="absolute top-2 left-2 bg-green-500 text-white rounded-full p-1 shadow-lg z-10"
                :title="t('inventory_usable_indicator')">
                <IconSparkles class="w-4 h-4" />
              </div>

              <!-- Item image with hover effect -->
              <div class="flex-1 flex items-center justify-center">
                <img 
                  :src="filteredItems[index].icon" 
                  :alt="filteredItems[index].name" 
                  class="w-28 h-28 object-contain transition-transform duration-300 group-hover:scale-110"
                  draggable="false" 
                />
              </div>

              <!-- Item name with rarity gradient -->
              <div class="w-full text-center">
                <p class="text-sm font-bold leading-tight opacity-90 bg-[length:200%_auto] bg-clip-text text-transparent animate-gold-shine px-2"
                  :class="`${rarityClasses[filteredItems[index].class]}`">
                  {{ filteredItems[index].name }}
                </p>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="max-w-xs">
            <div class="space-y-2">
              <p class="font-bold" :class="rarityClasses[filteredItems[index].class]">
                {{ filteredItems[index].name }}
              </p>
              <p v-if="filteredItems[index].desc" class="text-sm text-muted-foreground">
                {{ filteredItems[index].desc }}
              </p>
              <div class="flex items-center gap-2 text-xs text-muted-foreground">
                <span class="font-semibold">{{ t('inventory_rarity') }}</span>
                <span :class="rarityClasses[filteredItems[index].class]">
                  {{ filteredItems[index].class }}
                </span>
              </div>
              <div v-if="filteredItems[index].usable" class="text-xs text-green-500 flex items-center gap-1">
                <IconSparkles class="w-3 h-3" />
                <span>{{ t('inventory_click_to_use') }}</span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </template>
  </InventoryView>

  <InventoryItemGranted 
    v-model="open" 
    :item="selected" 
    @primary="onGrantedClose" 
    @secondary="share"
    :primary-action="t('inventory_claim')" 
    :getCardClass="(i: string | null) => rarityClasses[(i as ItemQuality) ?? 'rare']" 
  />

  <InventoryItemGranted 
    v-model="openSidebar" 
    :item="selected" 
    @primary="useItem()"
    :primary-action="selected?.usable ? t('inventory_use') : undefined" 
    :title="t('inventory_item_details')"
    :getCardClass="(i: string | null) => rarityClasses[(i as ItemQuality) ?? 'rare']" 
  />
</template>

<style scoped>
.animate-gold-shine {
  animation: gold-shine 3s linear infinite;
  background-size: 200% auto;
}

@keyframes gold-shine {
  0% {
    background-position: 0% center;
  }

  100% {
    background-position: 200% center;
  }
}
</style>
