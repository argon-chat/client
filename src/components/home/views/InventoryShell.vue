<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import InventoryView from './InventoryView.vue';
import InventoryItemGranted from './InventoryItemGranted.vue';
import { useApi } from '@/store/system/apiStore';
import { logger } from '@argon/core';
import { CosmeticAcquisition, InventoryItem, RedeemError, type CatalogueCosmetic } from '@argon/glue';
import { IonDateTime } from '@argon-chat/ion.webcore';
import { type ItemDef, type ItemQuality, itemsById, getItemIcon, rarityClasses, rarityClassesCards, rarities, allItems } from "@argon/inventory";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@argon/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@argon/ui/tooltip';
import { IconFilter, IconSortAscending, IconSparkles, IconQuestionMark, IconStack2 } from '@tabler/icons-vue';
import { useConfigStore } from '@/store/ui/configStore';
import { useCosmeticsStore } from '@/store/features/cosmeticsStore';
import { resolveKind } from '@/cosmetics/registry';
import { cdnUrl } from '@/store/system/fileStorage';
import { Button } from '@argon/ui/button';
import { useLocale } from '@/store/system/localeStore';
import { cosmeticName } from '@/lib/cosmeticText';
import { useToast } from '@argon/ui/toast';
import { useNotifications } from '@/composables/useNotifications';

export type InventoryItemView = InventoryItem & ItemDef & {
  icon: string;
};

defineOptions({ inheritAttrs: false });

const localeStore = useLocale();
const { t } = localeStore;
const { currentLocale } = storeToRefs(localeStore);
const api = useApi();
const inventory = computed(() => api.inventoryInteraction);
const toast = useToast();
const notificationsStore = useNotifications();

const configStore = useConfigStore();
const cosmetics = useCosmeticsStore();
const isDevMode = computed(() => {
  if (!argon.isArgonHost) return true;
  return configStore.devModeEnabled;
});

const rawInventoryItems = ref<InventoryItem[]>([]);

/**
 * What the grid draws, derived rather than built once on load.
 *
 * A key describes itself from the cosmetics catalogue, and the inventory deliberately does not wait
 * for that catalogue — so this has to re-run when it lands. Built once, a key granted before the
 * rows arrived would keep the placeholder it was first drawn with until the screen was reopened.
 */
const myInventoryItems = computed<InventoryItemView[]>(() => rawInventoryItems.value.map(toItemView));
const itemsByInstanceId = computed(() => new Map(myInventoryItems.value.map(i => [i.instanceId, i])));

/**
 * A still picture of a cosmetic, for drawing in an `<img>`.
 *
 * The slot cannot be picked by name. `Primary` means "the thing itself", and for a background the
 * thing itself is a video — putting that file in an `<img>` is a broken image, not a picture. So
 * ask the kind what it draws with instead of guessing: a `videoLayer` keeps its still in `Poster`,
 * which is the whole reason that slot exists.
 *
 * A row with no usable picture leaves the icon empty, which every caller already draws as its
 * unknown-item placeholder — the honest answer, and better than a broken image.
 */
function cosmeticIcon(cosmetic: CatalogueCosmetic): string {
  const slot = (name: string) => cosmetic.assets.find(asset => asset.slot === name);

  // `Poster` is optional on the server, so a video with no still has nothing to show here.
  if (resolveKind(cosmetic.kindKey)?.primitive === 'videoLayer') {
    const poster = slot('Poster');

    return poster ? cdnUrl(poster.fileId) : '';
  }

  // Everything else draws a picture of some kind. The loose end is a frame, whose parts are keyed by
  // their own per-part slot names — there may be no `Primary` at all, and the first asset is then a
  // known approximation of "the piece a person would recognise" rather than a considered choice.
  const asset = slot('Poster') ?? slot('Primary') ?? cosmetic.assets[0];

  return asset ? cdnUrl(asset.fileId) : '';
}

/**
 * A catalogue rarity as something the inventory has a style for.
 *
 * Rarity is free text on the server — an operator types it into the admin console — so anything
 * that is not one of the four qualities falls back to the plainest rather than to a missing class.
 * Matched case-insensitively because the only thing between "legendary" and "Legendary" is whoever
 * was typing.
 */
function cosmeticRarity(rarity: string | null): ItemQuality {
  const named = (rarity ?? '').trim().toLowerCase() as ItemQuality;

  return rarities.includes(named) ? named : 'common';
}

function toItemView(item: InventoryItem): InventoryItemView {
  const meta = itemsById[item.id];
  const view: InventoryItemView = {
    ...item,
    ...(meta ?? { id: item.id, desc: "", name: item.id, class: "common" as ItemQuality, size: 0 }),
    icon: meta ? (getItemIcon(meta.id) ?? '') : '',
  };

  // Translate name and desc using locale keys
  if (meta) {
    view.name = t(meta.name);
    view.desc = t(meta.desc);
  }

  // `cosmeticId` is what makes an item a key, and what it opens is the only thing worth showing for
  // it. That description has to come from the catalogue: describing every key in the static package
  // would make each new cosmetic in a case a client release, which is the whole reason for this.
  // A row that is not here — not read yet, unpublished, deleted — leaves the item as the plain one
  // built above rather than breaking the list.
  const opens = cosmetics.catalogueItemById(item.cosmeticId);

  if (opens) {
    view.name = cosmeticName(opens, currentLocale.value);
    view.class = cosmeticRarity(opens.rarity);
    view.icon = cosmeticIcon(opens);
  }

  return view;
}

const grantQueue = ref<InventoryItemView[]>([]);
const loading = ref(true);
const initialSlots = 12;

const open = ref(false);
const openSidebar = ref(false);
const selected = ref<InventoryItemView | null>(null);

// Filters and sorting
const selectedRarity = ref<string | null>(null);
const sortBy = ref<'name' | 'rarity' | 'recent'>('recent');
const groupByType = ref(true);

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

export type GroupedItem = {
  representative: InventoryItemView;
  count: number;
  instances: InventoryItemView[];
};

const groupedItems = computed<GroupedItem[]>(() => {
  if (!groupByType.value) {
    return filteredItems.value.map(item => ({ representative: item, count: 1, instances: [item] }));
  }
  const groups = new Map<string, GroupedItem>();
  for (const item of filteredItems.value) {
    // Two keys are the same item only when they open the same cosmetic. Stacking them by template
    // alone would show one name and a count over a pile of different things.
    const groupKey = item.cosmeticId ? `${item.id}:${item.cosmeticId}` : item.id;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.count++;
      existing.instances.push(item);
    } else {
      groups.set(groupKey, { representative: item, count: 1, instances: [item] });
    }
  }
  return [...groups.values()];
});

const displayItems = computed(() => groupedItems.value);

onMounted(async () => {
  // Nothing here has necessarily read the catalogue — the cosmetics picker is what usually does, and
  // somebody can walk straight into the inventory. Deliberately not awaited: keys draw as plain
  // items until the rows land and redraw themselves when they do, rather than holding up the grid.
  if (!cosmetics.catalogue) void cosmetics.loadCatalogue();

  await reloadData();
});

async function reloadData() {
  loading.value = true;
  try {
    const [myItems, notifications] = await Promise.all([
      inventory.value.GetMyInventoryItems(),
      inventory.value.GetNotifications()
    ]);

    rawInventoryItems.value = myItems;

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

  // A key has no static definition — that is the entire point of it — so until the catalogue is
  // here it is a raw id and a placeholder. Showing that off as "you received an item", then
  // rewriting the name under the player when the rows land, is worse than a moment's wait. Only
  // this path waits: the grid behind the dialog keeps rendering, and a catalogue already read makes
  // this a no-op.
  if (next.cosmeticId && !cosmetics.catalogue) await cosmetics.loadCatalogue();

  // Re-read after the wait, because `next` is a snapshot from before the catalogue answered.
  selected.value = itemsByInstanceId.value.get(next.instanceId) ?? next;
  open.value = true;

  if (next.instanceId.startsWith("debug-")) return;

  try {
    await notificationsStore.markInventoryItemSeen(next.instanceId);
  } catch (e) {
    logger.warn("Failed to mark seen", e, next.instanceId);
  }
}

function onSlotClick(i: number) {
  const group = displayItems.value[i];
  if (!group) return;
  selected.value = group.representative;
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

/** The cosmetic the selected item opens, when the selection is a key at all. */
const selectedCosmetic = computed(() =>
  selected.value ? cosmetics.catalogueItemById(selected.value.cosmeticId) : null);

/**
 * The ways the server answers "owned" with no ownership row behind it.
 *
 * `Owns` on the server says true for a `Free` item for everybody, and for an `UltimaTier` item for
 * anybody currently subscribed — in both cases without a row existing. A key to such a cosmetic is
 * still worth using: it writes a real, permanent row, which is exactly the thing that outlives a
 * subscription. So a row reachable either of these ways tells us nothing about whether a use would
 * be refused, and must not be the reason a key is greyed out.
 */
const OWNED_WITHOUT_A_ROW: readonly CosmeticAcquisition[] = [
  CosmeticAcquisition.Free,
  CosmeticAcquisition.UltimaTier,
];

/**
 * Whether the selected key opens something its owner already holds outright.
 *
 * The server refuses such a use and, deliberately, keeps the item rather than spending it, so a
 * spare can be given away. It cannot say why: `UseItem` answers with a bare bool and widening it
 * would break every client already installed. So this is the one place that can explain the refusal
 * — the server still enforces it, this only tells the player.
 *
 * `owned` on its own is the wrong question. It means "can wear right now", not "has a row", and the
 * two differ for precisely the cosmetics a key is most worth spending on. Nothing in this client
 * reads the ownership rows themselves — `GetMyCosmetics`, which carries `viaSubscription` and would
 * answer this exactly, is on the wire but called nowhere — and fetching them here would add a second
 * thing to keep fresh on every use. So the question is narrowed instead: grey out only when the row
 * is owned and could not have been owned without a row.
 *
 * It errs towards letting the player press the button. A wrong "yes, press it" costs one refused
 * call and keeps the item; a wrong "no" talks somebody out of a permanent cosmetic they could have
 * had. The known residual is a kind whose entitlement is `Free` as a whole: the server grants that
 * with no row and no per-item flag, and `CosmeticKindSummary` does not carry entitlement, so this
 * cannot see it — it fails in the safe direction, towards a pressable button.
 */
const selectedIsOwnedKey = computed(() => {
  const cosmetic = selectedCosmetic.value;

  if (cosmetic?.owned !== true) return false;

  const ways = cosmetic.acquisition ?? [];

  return !ways.some(way => OWNED_WITHOUT_A_ROW.includes(way));
});

async function useItem() {
  openSidebar.value = false;
  const itemName = selected.value?.name || 'item';

  // Read before the call, because the success path clears the selection before anything can ask
  // what was spent.
  const openedCosmeticId = selected.value?.cosmeticId ?? null;

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

      // Spending a key flips `owned` on the row it opened, and nothing else on this screen ever
      // re-reads the catalogue — `reloadData` refetches inventory items and notifications only, and
      // `loadCatalogue` otherwise runs on mount and on the grant path. Without this, a second key
      // for the same cosmetic stays pressable for the rest of the session: the server refuses it and
      // the player gets the generic destructive failure instead of the calm explanation written for
      // exactly this moment. `loadCatalogue` shares a read already in flight, so it is cheap.
      const refreshes: Promise<unknown>[] = [reloadData()];

      if (openedCosmeticId) {
        refreshes.push(cosmetics.loadCatalogue());
      }

      await Promise.all(refreshes);
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

/**
 * Keeps the open dialog on the same item as the grid.
 *
 * `selected` is a snapshot taken when the slot was clicked, and the catalogue can land a moment
 * later — this is what stops a key that was opened early from sitting there under its placeholder
 * while the grid behind it already shows the real thing. An item that is simply gone (used, or
 * a debug grant that was never in the list) is left alone.
 */
watch(myInventoryItems, (items) => {
  if (!selected.value) return;

  const fresh = items.find(item => item.instanceId === selected.value!.instanceId);

  if (fresh) selected.value = fresh;
});

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
    grantedDate: IonDateTime.now(),
    usableVector: null,
    receivedFrom: null,
    ttl: null,
    cosmeticId: null,
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
    :slots="loading ? initialSlots : displayItems.length" 
    :item-count="loading ? undefined : filteredItems.length"
    :loading="loading"
    :has-item="(i) => !!displayItems[i]"
    :get-item-count="(i) => displayItems[i]?.count ?? 0"
    :is-unknown-item="(i) => !!displayItems[i] && !displayItems[i].representative.icon"
    @slot:click="onSlotClick" 
    @redeem="onRedeem"
    :getCardClass="i => displayItems[i] ? rarityClassesCards[displayItems[i].representative.class] : ''" 
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
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm" class="gap-2">
            <IconFilter class="w-4 h-4" />
            {{ selectedRarity ? selectedRarity.charAt(0).toUpperCase() + selectedRarity.slice(1) : t('inventory_filter_all') }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem @click="selectedRarity = null">
            <span :class="!selectedRarity ? 'font-bold' : ''">{{ t('inventory_filter_all_items') }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem 
            v-for="rarity in rarities" 
            :key="rarity"
            @click="selectedRarity = rarity"
          >
            <span :class="[rarityClasses[rarity], selectedRarity === rarity ? 'font-bold' : '']">
              {{ rarity.charAt(0).toUpperCase() + rarity.slice(1) }}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- Sort Dropdown -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm" class="gap-2">
            <IconSortAscending class="w-4 h-4" />
            {{ sortBy === 'name' ? t('inventory_sort_name') : sortBy === 'rarity' ? t('inventory_sort_rarity') : t('inventory_recent') }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem @click="sortBy = 'recent'">
            <span :class="sortBy === 'recent' ? 'font-bold' : ''">{{ t('inventory_sort_recent') }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem @click="sortBy = 'name'">
            <span :class="sortBy === 'name' ? 'font-bold' : ''">{{ t('inventory_sort_name') }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem @click="sortBy = 'rarity'">
            <span :class="sortBy === 'rarity' ? 'font-bold' : ''">{{ t('inventory_sort_rarity') }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- Group Toggle -->
      <Button 
        variant="outline" 
        size="sm" 
        class="gap-2"
        :class="groupByType ? 'border-violet-500/50 bg-violet-500/10' : ''"
        @click="groupByType = !groupByType"
      >
        <IconStack2 class="w-4 h-4" />
        {{ t('inventory_group') }}
      </Button>
    </template>

    <template #item="{ index }">
      <TooltipProvider v-if="displayItems[index]">
        <Tooltip :delay-duration="300">
          <TooltipTrigger as-child>
            <div class="relative flex flex-col items-center gap-2 w-full h-full p-2">
              <!-- Usable indicator -->
              <div v-if="displayItems[index].representative.usable" 
                class="absolute top-2 left-2 bg-green-500 text-white rounded-full p-1 shadow-lg z-10"
                :title="t('inventory_usable_indicator')">
                <IconSparkles class="w-4 h-4" />
              </div>

              <!-- Item image with hover effect -->
              <div class="flex-1 flex items-center justify-center">
                <img 
                  v-if="displayItems[index].representative.icon"
                  :src="displayItems[index].representative.icon" 
                  :alt="displayItems[index].representative.name" 
                  class="w-28 h-28 object-contain transition-transform duration-300 group-hover:scale-110"
                  draggable="false" 
                />
                <IconQuestionMark v-else class="w-20 h-20 text-amber-400/60" stroke-width="1.5" />
              </div>

              <!-- Item name with rarity gradient -->
              <div class="w-full text-center">
                <p class="text-sm font-bold leading-tight opacity-90 bg-[length:200%_auto] bg-clip-text text-transparent animate-gold-shine px-2"
                  :class="`${rarityClasses[displayItems[index].representative.class]}`">
                  {{ displayItems[index].representative.name }}
                </p>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="max-w-xs">
            <div class="space-y-2">
              <p class="font-bold" :class="rarityClasses[displayItems[index].representative.class]">
                {{ displayItems[index].representative.name }}
              </p>
              <p v-if="displayItems[index].representative.desc" class="text-sm text-muted-foreground">
                {{ displayItems[index].representative.desc }}
              </p>
              <div class="flex items-center gap-2 text-xs text-muted-foreground">
                <span class="font-semibold">{{ t('inventory_rarity') }}</span>
                <span :class="rarityClasses[displayItems[index].representative.class]">
                  {{ displayItems[index].representative.class }}
                </span>
              </div>
              <div v-if="displayItems[index].count > 1" class="text-xs text-violet-400 font-medium">
                {{ t('inventory_quantity') }}: {{ displayItems[index].count }}
              </div>
              <div v-if="displayItems[index].representative.usable" class="text-xs text-green-500 flex items-center gap-1">
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
    :primary-disabled="selectedIsOwnedKey"
    :note="selectedIsOwnedKey ? t('inventory_key_already_owned') : undefined"
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
