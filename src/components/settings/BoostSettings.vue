<template>
  <div class="boost-page">
    <div v-if="ultima.loading" class="loader-wrap">
      <Loader2 class="w-8 h-8 animate-spin text-violet-400" />
    </div>

    <template v-else>
      <!-- ═══════════════════ BOOSTS ═══════════════════ -->
      <div class="glass-card">
        <div class="glass-card-border" />

        <!-- Header with summary -->
        <div class="card-head">
          <div class="card-icon ci-boost">
            <RocketIcon class="w-5 h-5" />
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="card-title">{{ t('ultima_server_boosts') }}</h3>
            <p class="card-subtitle">{{ t('ultima_boosts_subtitle') }}</p>
          </div>
          <div class="boost-summary">
            <div class="summary-bar">
              <div class="summary-bar-fill" :style="{ width: boostBarPercent + '%' }" />
            </div>
            <span class="summary-text">{{ assignedBoosts.length }}/{{ ultima.boosts.length }}</span>
          </div>
          <div class="avail-pill">{{ t('ultima_n_available', { n: ultima.unassignedBoosts.length }) }}</div>
        </div>

        <!-- Empty State -->
        <div v-if="ultima.boosts.length === 0" class="empty-state">
          <div class="empty-icon-wrap">
            <RocketIcon class="w-10 h-10 text-violet-500/30" />
          </div>
          <p class="empty-label">{{ t('ultima_no_boosts') }}</p>
          <p class="empty-hint">{{ t('ultima_no_boosts_hint') }}</p>
          <button v-if="ultima.pricing" class="empty-cta" @click="scrollToShop">
            <RocketIcon class="w-4 h-4" />
            {{ t('ultima_boost_empty_cta') }}
          </button>
        </div>

        <!-- Boost Groups -->
        <template v-else>
          <!-- Assigned: Grouped by Space -->
          <div v-if="assignedBoosts.length > 0" class="boost-group">
            <p class="group-label">{{ t('ultima_boost_assigned_group') }}</p>
            <div class="boost-grid">
              <div
                v-for="group in boostsBySpace"
                :key="group.spaceId"
                class="boost-space-card"
                :class="{ 'expanded': expandedSpace === group.spaceId }"
              >
                <div class="boost-space-card-head" @click="toggleExpanded(group.spaceId)">
                  <ArgonAvatar
                    :fallback="group.spaceName ?? '?'"
                    :space-id="group.spaceId"
                    class="w-8 h-8 rounded-lg flex-shrink-0"
                  />
                  <div class="flex-1 min-w-0">
                    <p class="boost-name">{{ group.spaceName }}</p>
                    <p class="boost-detail">
                      <span class="boost-count-badge">{{ group.boosts.length }} boost{{ group.boosts.length > 1 ? 's' : '' }}</span>
                    </p>
                  </div>
                  <span class="expand-chevron" :class="{ rotated: expandedSpace === group.spaceId }">›</span>
                </div>
                <Transition name="expand">
                  <div v-if="expandedSpace === group.spaceId" class="boost-space-details">
                    <div v-for="boost in group.boosts" :key="boost.boostId" class="boost-subitem">
                      <span class="source-badge" :class="'src-' + boost.source">{{ boostSourceLabel(boost.source) }}</span>
                      <span v-if="isOnCooldown(boost)" class="cooldown-tag">⏱ {{ formatDate(boost.transferCooldownUntil) }}</span>
                      <div class="boost-actions ml-auto">
                        <button class="boost-action-btn transfer-btn" :disabled="isOnCooldown(boost)" @click.stop="openSpacePicker(boost.boostId, 'transfer')">
                          {{ t('ultima_boost_transfer') }}
                        </button>
                        <button class="boost-action-btn remove-btn" @click.stop="handleRemoveBoost(boost.boostId)">
                          {{ t('ultima_boost_remove') }}
                        </button>
                      </div>
                    </div>
                  </div>
                </Transition>
              </div>
            </div>
          </div>

          <!-- Unassigned: Compact summary -->
          <div v-if="ultima.unassignedBoosts.length > 0" class="boost-group">
            <p class="group-label">{{ t('ultima_boost_unassigned_group') }}</p>
            <div class="unassigned-summary">
              <div class="unassigned-summary-head">
                <div class="boost-indicator-unassigned">
                  <RocketIcon class="w-4 h-4" />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="boost-name muted">{{ ultima.unassignedBoosts.length }} {{ t('ultima_unassigned') }}</p>
                  <p class="boost-detail">
                    <span v-for="(count, source) in unassignedBySource" :key="source" class="source-badge" :class="'src-' + source">
                      {{ count }}× {{ boostSourceLabel(Number(source)) }}
                    </span>
                  </p>
                </div>
                <button class="boost-action-btn assign-btn" @click="expandedSpace = expandedSpace === '__unassigned' ? null : '__unassigned'">
                  {{ expandedSpace === '__unassigned' ? t('ultima_boost_collapse') || 'Collapse' : t('ultima_boost_expand') || 'Expand' }}
                </button>
              </div>
              <Transition name="expand">
                <div v-if="expandedSpace === '__unassigned'" class="boost-space-details">
                  <div v-for="boost in ultima.unassignedBoosts" :key="boost.boostId" class="boost-subitem">
                    <span class="source-badge" :class="'src-' + boost.source">{{ boostSourceLabel(boost.source) }}</span>
                    <button class="boost-action-btn assign-btn ml-auto" @click="openSpacePicker(boost.boostId, 'assign')">
                      {{ t('ultima_boost_assign') }}
                    </button>
                  </div>
                </div>
              </Transition>
            </div>
          </div>
        </template>

        <!-- Space Picker Overlay -->
        <Transition name="picker-fade">
          <div v-if="spacePickerOpen" class="space-picker-backdrop" @click.self="closeSpacePicker">
            <div class="space-picker">
              <div class="space-picker-head">
                <p class="space-picker-title">{{ t('ultima_boost_select_space') }}</p>
                <button class="space-picker-close" @click="closeSpacePicker">×</button>
              </div>
              <input
                v-model="spacePickerQuery"
                class="space-picker-input"
                :placeholder="t('ultima_boost_search_spaces')"
                ref="spacePickerInputRef"
              />
              <div class="space-picker-list">
                <div v-if="filteredSpaces.length === 0" class="space-picker-empty">
                  {{ t('ultima_boost_no_spaces') }}
                </div>
                <button
                  v-for="space in filteredSpaces"
                  :key="space.spaceId"
                  class="space-picker-item"
                  @click="handleSpaceSelected(space.spaceId)"
                >
                  <ArgonAvatar
                    :fallback="space.name"
                    :space-id="space.spaceId"
                    class="w-7 h-7 rounded-md flex-shrink-0"
                  />
                  <div class="flex-1 min-w-0">
                    <span class="space-picker-name">{{ space.name }}</span>
                    <span v-if="space.boostCount > 0" class="space-picker-boosts">🚀 {{ space.boostCount }}</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <!-- ═══════════════════ BUY BOOSTS ═══════════════════ -->
      <div v-if="ultima.pricing" class="glass-card shop-variant" ref="shopCardRef">
        <div class="glass-card-border shop-border" />
        <div class="card-head">
          <div class="card-icon ci-shop">
            <ShoppingBagIcon class="w-5 h-5" />
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="card-title">{{ t('ultima_boost_shop_title') }}</h3>
            <p class="card-subtitle">{{ t('ultima_boost_shop_subtitle') }}</p>
          </div>
          <div class="boost-period-toggle">
            <button :class="{ on: boostPeriod === 'monthly' }" @click="boostPeriod = 'monthly'">{{ t('ultima_boost_monthly') }}</button>
            <button :class="{ on: boostPeriod === 'annual' }" @click="boostPeriod = 'annual'">{{ t('ultima_boost_annual') }}</button>
          </div>
        </div>

        <!-- Pack Cards -->
        <div class="packs-row">
          <div
            v-for="(pack, idx) in boostPacks"
            :key="pack.type"
            class="pack-card"
            :class="{ 'pack-featured': idx === 2 }"
          >
            <div v-if="idx === 2" class="pack-best-badge">{{ t('ultima_boost_best_value') }}</div>
            <div class="pack-rockets">
              <RocketIcon v-for="i in pack.count" :key="i" class="w-5 h-5" />
            </div>
            <span class="pack-qty">{{ pack.count }} <span class="pack-qty-label">{{ pack.count === 1 ? 'Boost' : 'Boosts' }}</span></span>
            <span class="pack-price">{{ pack.price.amount }} {{ pack.price.currency }}</span>
            <span class="pack-per-unit">{{ perBoostPrice(pack) }} / {{ t('ultima_boost_per_unit') }}</span>
            <span v-if="packSavings(idx) > 0" class="pack-savings">{{ t('ultima_boost_save_percent', { percent: packSavings(idx) }) }}</span>
            <span class="pack-period-label">{{ boostPeriod === 'monthly' ? t('ultima_boost_period_monthly') : t('ultima_boost_period_annual') }}</span>
            <button class="pack-buy-btn" :disabled="purchasingPack !== null" @click="handlePurchaseBoostPack(pack.type)">
              <Loader2 v-if="purchasingPack === pack.type" class="w-4 h-4 animate-spin" />
              <ShoppingBagIcon v-else class="w-4 h-4" />
              {{ t('ultima_boost_buy') }}
            </button>
          </div>
        </div>
      </div>

      <!-- ═══════════════════ GIFT ═══════════════════ -->
      <div class="glass-card gift-variant">
        <div class="glass-card-border gift-border" />
        <div class="card-head">
          <div class="card-icon ci-gift">
            <GiftIcon class="w-5 h-5" />
          </div>
          <div>
            <h3 class="card-title">{{ t('ultima_gift') }}</h3>
            <p class="card-subtitle">{{ t('ultima_gift_subtitle') }}</p>
          </div>
        </div>

        <div class="gift-form">
          <!-- Friend Picker -->
          <div class="gift-field">
            <label>{{ t('ultima_gift_send_to') }}</label>
            <div v-if="giftRecipientId" class="gift-selected-friend">
              <ArgonAvatar
                :fallback="giftRecipientName"
                :file-id="friendsList.find(f => f.userId === giftRecipientId)?.avatarFileId ?? null"
                :user-id="giftRecipientId"
                class="w-6 h-6 rounded-full flex-shrink-0"
              />
              <span class="gift-selected-name">{{ giftRecipientName }}</span>
              <button class="gift-selected-clear" @click="giftRecipientId = ''; giftRecipientName = ''" type="button">×</button>
            </div>
            <div v-else class="friend-search-box">
              <input
                v-model="friendPickerQuery"
                class="friend-search-input"
                :placeholder="t('ultima_gift_search_friends')"
              />
              <div v-if="friendPickerQuery.length > 0" class="friend-search-results">
                <div v-if="friendsLoading" class="friend-search-empty">
                  <Loader2 class="w-3.5 h-3.5 animate-spin" /> {{ t('ultima_gift_searching') }}
                </div>
                <div v-else-if="filteredFriends.length === 0" class="friend-search-empty">
                  {{ t('ultima_gift_no_match', { query: friendPickerQuery }) }}
                </div>
                <button
                  v-for="friend in filteredFriends"
                  :key="friend.userId"
                  class="friend-search-item"
                  @click="selectFriend(friend)"
                  type="button"
                >
                  <ArgonAvatar
                    :fallback="friend.displayName"
                    :file-id="friend.avatarFileId"
                    :user-id="friend.userId"
                    class="w-6 h-6 rounded-full flex-shrink-0"
                  />
                  <span class="friend-search-item-name">{{ friend.displayName }}</span>
                  <span class="friend-search-item-user">@{{ friend.username }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Message -->
          <div class="gift-field">
            <label>{{ t('ultima_gift_message') }}</label>
            <Input v-model="giftMessage" :placeholder="t('ultima_gift_message_placeholder')" class="gift-input" />
          </div>

          <!-- Controls row -->
          <div class="gift-controls">
            <div class="gift-toggle">
              <button :class="{ on: giftPlan === UltimaPlan.Monthly }" @click="giftPlan = UltimaPlan.Monthly">{{ t('ultima_gift_1_month') }}</button>
              <button :class="{ on: giftPlan === UltimaPlan.Annual }" @click="giftPlan = UltimaPlan.Annual">{{ t('ultima_gift_1_year') }}</button>
            </div>
            <button
              class="gift-btn"
              @click="handleSendGift"
              :disabled="!giftRecipientId || sendingGift"
            >
              <Loader2 v-if="sendingGift" class="w-4 h-4 animate-spin" />
              <template v-else>
                <GiftIcon class="w-4 h-4" />
                <span>{{ t('ultima_gift_send') }}</span>
              </template>
            </button>
          </div>
        </div>
      </div>
    </template>

    <UltimaCheckoutDialog v-model:open="checkoutOpen" :checkout-url="checkoutUrl" :country-code="checkoutCountry" mode="one-time" @completed="onCheckoutCompleted" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from "vue";
import { Input } from "@argon/ui/input";
import { useToast } from "@argon/ui/toast";
import { Loader2, RocketIcon, GiftIcon, ShoppingBagIcon } from "lucide-vue-next";
import { useUltimaStore } from "@/store/data/ultimaStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useApi } from "@/store/system/apiStore";
import { useUserStore } from "@/store/data/userStore";
import {
  UltimaPlan,
  BoostPackType,
  BoostSource,
  PurchaseBoostError,
  SendGiftError,
  ApplyBoostError,
  TransferBoostError,
} from "@argon/glue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import UltimaCheckoutDialog from "@/components/modals/UltimaCheckoutDialog.vue";
import type { Guid } from "@argon-chat/ion.webcore";
import type { RealtimeUser } from "@/store/db/dexie";
import { useLocale } from "@/store/system/localeStore";

const { t } = useLocale();
const ultima = useUltimaStore();
const pool = usePoolStore();
const { toast } = useToast();

// ─── Checkout ────────────────────────────────
const checkoutOpen = ref(false);
const checkoutUrl = ref("");
const checkoutCountry = ref("");
const shopCardRef = ref<HTMLElement | null>(null);
const purchasingPack = ref<BoostPackType | null>(null);

function scrollToShop() {
  shopCardRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ─── Space Picker ────────────────────────────
const allSpaces = pool.useAllServers();
const spacePickerOpen = ref(false);
const spacePickerQuery = ref("");
const spacePickerInputRef = ref<HTMLInputElement | null>(null);
const pickerBoostId = ref<Guid | null>(null);
const pickerMode = ref<"assign" | "transfer">("assign");

const filteredSpaces = computed(() => {
  const q = spacePickerQuery.value.toLowerCase();
  const spaces = allSpaces.value;
  if (!q) return spaces.slice(0, 20);
  return spaces.filter(s => s.name.toLowerCase().includes(q)).slice(0, 20);
});

function openSpacePicker(boostId: Guid, mode: "assign" | "transfer") {
  pickerBoostId.value = boostId;
  pickerMode.value = mode;
  spacePickerQuery.value = "";
  spacePickerOpen.value = true;
  nextTick(() => spacePickerInputRef.value?.focus());
}

function closeSpacePicker() {
  spacePickerOpen.value = false;
  pickerBoostId.value = null;
}

async function handleSpaceSelected(spaceId: Guid) {
  if (!pickerBoostId.value) return;
  const boostId = pickerBoostId.value;
  closeSpacePicker();

  if (pickerMode.value === "assign") {
    const result = await ultima.applyBoost(boostId, spaceId);
    if (result.success) {
      toast({ title: t('ultima_boost_assigned') });
    } else {
      toast({ title: t('ultima_boost_assign_failed'), description: applyBoostErrorMessage(result.error), variant: "destructive" });
    }
  } else {
    const result = await ultima.transferBoost(boostId, spaceId);
    if (result.success) {
      toast({ title: t('ultima_boost_transferred') });
    } else {
      toast({ title: t('ultima_boost_transfer_failed'), description: transferBoostErrorMessage(result.error), variant: "destructive" });
    }
  }
}

// ─── Boost Data ──────────────────────────────
const assignedBoosts = computed(() => ultima.boosts.filter(b => b.spaceId !== null));
const boostBarPercent = computed(() => {
  if (ultima.boosts.length === 0) return 0;
  return Math.round((assignedBoosts.value.length / ultima.boosts.length) * 100);
});

// ─── Grouped Boost Data ──────────────────────
const expandedSpace = ref<string | null>(null);

const boostsBySpace = computed(() => {
  const groups = new Map<string, { spaceId: string; spaceName: string | null; boosts: typeof assignedBoosts.value }>();
  for (const boost of assignedBoosts.value) {
    const key = boost.spaceId!;
    const existing = groups.get(key);
    if (existing) {
      existing.boosts.push(boost);
    } else {
      groups.set(key, { spaceId: key, spaceName: boost.spaceName ?? null, boosts: [boost] });
    }
  }
  return [...groups.values()];
});

const unassignedBySource = computed(() => {
  const counts: Record<number, number> = {};
  for (const boost of ultima.unassignedBoosts) {
    counts[boost.source] = (counts[boost.source] ?? 0) + 1;
  }
  return counts;
});

function toggleExpanded(spaceId: string) {
  expandedSpace.value = expandedSpace.value === spaceId ? null : spaceId;
}

function isOnCooldown(boost: { transferCooldownUntil: unknown }): boolean {
  if (!boost.transferCooldownUntil) return false;
  const d = typeof boost.transferCooldownUntil === "object" && boost.transferCooldownUntil !== null && "date" in boost.transferCooldownUntil
    ? (boost.transferCooldownUntil as { date: Date }).date
    : new Date(boost.transferCooldownUntil as string);
  return d > new Date();
}

// ─── Boost Packs ─────────────────────────────
const boostPeriod = ref<'monthly' | 'annual'>('monthly');

const boostPacks = computed(() => {
  if (!ultima.pricing) return [];
  if (boostPeriod.value === 'annual') {
    return [
      { type: BoostPackType.Pack1Annual, count: 1, price: ultima.pricing.boostPack1Annual },
      { type: BoostPackType.Pack3Annual, count: 3, price: ultima.pricing.boostPack3Annual },
      { type: BoostPackType.Pack5Annual, count: 5, price: ultima.pricing.boostPack5Annual },
    ];
  }
  return [
    { type: BoostPackType.Pack1, count: 1, price: ultima.pricing.boostPack1 },
    { type: BoostPackType.Pack3, count: 3, price: ultima.pricing.boostPack3 },
    { type: BoostPackType.Pack5, count: 5, price: ultima.pricing.boostPack5 },
  ];
});

function perBoostPrice(pack: { count: number; price: { amount: string } }): string {
  const total = parseFloat(pack.price.amount);
  if (isNaN(total) || pack.count === 0) return "—";
  return (total / pack.count).toFixed(2);
}

function packSavings(idx: number): number {
  if (!ultima.pricing || idx === 0) return 0;
  const basePrice = boostPeriod.value === 'annual'
    ? parseFloat(ultima.pricing.boostPack1Annual.amount)
    : parseFloat(ultima.pricing.boostPack1.amount);
  const currentPack = boostPacks.value[idx];
  if (!currentPack || isNaN(basePrice) || basePrice === 0) return 0;
  const currentPerUnit = parseFloat(currentPack.price.amount) / currentPack.count;
  if (isNaN(currentPerUnit)) return 0;
  return Math.round((1 - currentPerUnit / basePrice) * 100);
}

// ─── Gift ────────────────────────────────────
const giftRecipientId = ref("");
const giftRecipientName = ref("");
const giftMessage = ref("");
const giftPlan = ref(UltimaPlan.Monthly);
const sendingGift = ref(false);
const friendPickerQuery = ref("");
const friendsList = ref<RealtimeUser[]>([]);
const friendsLoading = ref(false);

const filteredFriends = computed(() => {
  const q = friendPickerQuery.value.toLowerCase();
  if (!q) return [];
  return friendsList.value
    .filter(f => f.username.toLowerCase().includes(q) || f.displayName.toLowerCase().includes(q))
    .slice(0, 8);
});

async function loadFriends() {
  friendsLoading.value = true;
  try {
    const api = useApi();
    const userStore = useUserStore();
    const friendships = await api.freindsInteraction.GetMyFriendships(100, 0);
    const users = await userStore.getUsersBatch(friendships.map(f => f.friendId));
    friendsList.value = [...users.values()];
  } catch (e) {
    console.error("Failed to load friends", e);
  } finally {
    friendsLoading.value = false;
  }
}

function selectFriend(user: RealtimeUser) {
  giftRecipientId.value = user.userId;
  giftRecipientName.value = user.displayName || user.username;
}

onMounted(() => {
  loadFriends();
  ultima.fetchBoosts();
});

// ─── Helpers ─────────────────────────────────
function boostSourceLabel(source: BoostSource): string {
  switch (source) {
    case BoostSource.Subscription: return t('ultima_boost_source_sub');
    case BoostSource.PurchasedPack1: return t('ultima_boost_source_pack1');
    case BoostSource.PurchasedPack3: return t('ultima_boost_source_pack3');
    case BoostSource.PurchasedPack5: return t('ultima_boost_source_pack5');
    case BoostSource.PurchasedPack1Annual: return t('ultima_boost_source_pack1_annual');
    case BoostSource.PurchasedPack3Annual: return t('ultima_boost_source_pack3_annual');
    case BoostSource.PurchasedPack5Annual: return t('ultima_boost_source_pack5_annual');
    case BoostSource.GiftReward: return t('ultima_boost_source_gift');
    default: return t('ultima_status_unknown');
  }
}

function formatDate(date: unknown): string {
  if (!date) return "—";
  const d = typeof date === "object" && date !== null && "date" in date ? (date as { date: Date }).date : new Date(date as string);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function applyBoostErrorMessage(error: ApplyBoostError): string {
  switch (error) {
    case ApplyBoostError.NO_AVAILABLE_SLOTS: return t('ultima_err_no_slots');
    case ApplyBoostError.NOT_A_MEMBER: return t('ultima_err_not_member');
    case ApplyBoostError.ALREADY_APPLIED: return t('ultima_err_already_applied');
    default: return t('ultima_err_unknown');
  }
}

function transferBoostErrorMessage(error: TransferBoostError): string {
  switch (error) {
    case TransferBoostError.ON_COOLDOWN: return t('ultima_err_on_cooldown');
    case TransferBoostError.NOT_A_MEMBER: return t('ultima_err_not_member');
    case TransferBoostError.NOT_APPLIED: return t('ultima_err_not_applied');
    default: return t('ultima_err_unknown');
  }
}

async function handleRemoveBoost(boostId: Guid) {
  const ok = await ultima.removeBoost(boostId);
  toast({ title: ok ? t('ultima_boost_removed') : t('ultima_boost_remove_failed'), variant: ok ? undefined : "destructive" });
}

async function handlePurchaseBoostPack(pack: BoostPackType) {
  purchasingPack.value = pack;
  try {
    const result = await ultima.purchaseBoostPack(pack);
    if (result.success) {
      checkoutUrl.value = result.checkoutUrl;
      checkoutCountry.value = result.countryCode;
      checkoutOpen.value = true;
    } else {
      toast({ title: t('ultima_purchase_failed'), description: result.error === PurchaseBoostError.LIMIT_REACHED ? t('ultima_err_boost_limit') : t('ultima_err_payment'), variant: "destructive" });
    }
  } finally {
    purchasingPack.value = null;
  }
}

async function handleSendGift() {
  sendingGift.value = true;
  try {
    const result = await ultima.sendGift(giftRecipientId.value as Guid, giftPlan.value, giftMessage.value || null);
    if (result.success) {
      checkoutUrl.value = result.checkoutUrl;
      checkoutCountry.value = result.countryCode;
      checkoutOpen.value = true;
      giftRecipientId.value = "";
      giftMessage.value = "";
    } else {
      toast({ title: t('ultima_gift_failed'), description: sendGiftErrorMessage(result.error), variant: "destructive" });
    }
  } finally {
    sendingGift.value = false;
  }
}

function onCheckoutCompleted() {
  checkoutOpen.value = false;
  ultima.fetchBoosts();
  toast({ title: t('ultima_payment_completed') });
}

function sendGiftErrorMessage(error: SendGiftError): string {
  switch (error) {
    case SendGiftError.USER_NOT_FOUND: return t('ultima_err_user_not_found');
    case SendGiftError.SELF_GIFT: return t('ultima_err_self_gift');
    case SendGiftError.PAYMENT_ERROR: return t('ultima_err_payment');
    default: return t('ultima_err_unknown');
  }
}
</script>

<style scoped>
.boost-page {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
  padding: 1rem 0;
}

.loader-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

/* ═══════════ GLASS CARDS ═══════════ */
.glass-card {
  position: relative;
  padding: 1.75rem;
  border-radius: 1.25rem;
  background: hsl(var(--card) / 0.8);
  border: 1px solid hsl(var(--border));
  backdrop-filter: blur(8px);
  overflow: hidden;
}

.glass-card-border {
  position: absolute;
  top: -1px;
  left: 10%;
  right: 10%;
  height: 1px;
  background: linear-gradient(90deg, transparent, hsl(270 60% 55% / 0.4), transparent);
}

.gift-border {
  background: linear-gradient(90deg, transparent, hsl(330 60% 55% / 0.35), transparent);
}

.gift-variant {
  background: linear-gradient(160deg, hsl(var(--card) / 0.8), hsl(330 15% 7% / 0.8));
}

/* ═══════════ CARD HEADER ═══════════ */
.card-head {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.card-icon {
  width: 40px;
  height: 40px;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ci-boost {
  background: linear-gradient(135deg, hsl(270 50% 18%), hsl(270 40% 22%));
  color: hsl(270 80% 70%);
  box-shadow: 0 2px 8px hsl(270 50% 30% / 0.3);
}

.ci-gift {
  background: linear-gradient(135deg, hsl(330 50% 18%), hsl(330 40% 22%));
  color: hsl(330 80% 70%);
  box-shadow: 0 2px 8px hsl(330 50% 30% / 0.3);
}

.card-title { font-size: 1.0625rem; font-weight: 700; }
.card-subtitle { font-size: 0.6875rem; color: hsl(var(--muted-foreground)); }

/* ═══════════ BOOST SUMMARY BAR ═══════════ */
.boost-summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.summary-bar {
  width: 60px;
  height: 6px;
  border-radius: 3px;
  background: hsl(var(--muted) / 0.5);
  overflow: hidden;
}

.summary-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, hsl(270 70% 55%), hsl(290 60% 50%));
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.summary-text {
  font-size: 0.6875rem;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
}

.avail-pill {
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  background: hsl(270 35% 12%);
  color: hsl(270 65% 72%);
  border: 1px solid hsl(270 30% 22%);
  white-space: nowrap;
}

/* ═══════════ EMPTY STATE ═══════════ */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2.5rem 1rem;
  text-align: center;
}

.empty-icon-wrap {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: hsl(270 30% 12%);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
}

.empty-label { font-size: 0.875rem; font-weight: 500; color: hsl(var(--muted-foreground)); }
.empty-hint { font-size: 0.75rem; color: hsl(var(--muted-foreground) / 0.5); margin-top: 0.25rem; }

.empty-cta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 1.25rem;
  padding: 0.5rem 1.25rem;
  border-radius: 0.5rem;
  border: none;
  font-size: 0.8125rem;
  font-weight: 700;
  color: white;
  background: linear-gradient(135deg, hsl(270 65% 45%), hsl(290 55% 40%));
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 3px 10px hsl(270 60% 30% / 0.3);
}

.empty-cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 5px 16px hsl(270 60% 30% / 0.4);
}

/* ═══════════ BOOST GROUPS ═══════════ */
.boost-group { margin-bottom: 1.25rem; }
.boost-group:last-child { margin-bottom: 0; }

.group-label {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: hsl(var(--muted-foreground) / 0.6);
  margin-bottom: 0.5rem;
  padding-left: 0.25rem;
}

/* ═══════════ BOOST LIST ═══════════ */
.boost-list { display: flex; flex-direction: column; gap: 0.25rem; }

.boost-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border-radius: 0.625rem;
  transition: background 0.15s;
}

.boost-item:hover { background: hsl(var(--muted) / 0.4); }

.boost-indicator-unassigned {
  width: 32px;
  height: 32px;
  border-radius: 0.5rem;
  background: hsl(270 25% 14%);
  border: 1px dashed hsl(270 40% 30% / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(270 50% 50% / 0.6);
  flex-shrink: 0;
}

.boost-name { font-size: 0.8125rem; font-weight: 550; }
.boost-name.muted { color: hsl(var(--muted-foreground)); font-style: italic; }

.boost-detail {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.125rem;
}

.source-badge {
  font-size: 0.625rem;
  font-weight: 600;
  padding: 0.125rem 0.4rem;
  border-radius: 0.25rem;
  background: hsl(270 30% 15%);
  color: hsl(270 60% 68%);
}

.source-badge.src-0 { background: hsl(270 30% 15%); color: hsl(270 60% 68%); }
.source-badge.src-1,
.source-badge.src-2,
.source-badge.src-3 { background: hsl(220 30% 15%); color: hsl(220 60% 68%); }
.source-badge.src-4 { background: hsl(330 30% 15%); color: hsl(330 60% 68%); }

.cooldown-tag {
  font-size: 0.625rem;
  color: hsl(35 70% 55%);
}

/* ═══════════ BOOST GRID (GROUPED) ═══════════ */
.boost-grid {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.boost-space-card {
  border-radius: 0.625rem;
  border: 1px solid hsl(var(--border) / 0.5);
  overflow: hidden;
  transition: border-color 0.2s;
}

.boost-space-card.expanded {
  border-color: hsl(270 40% 40% / 0.4);
}

.boost-space-card-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: background 0.15s;
}

.boost-space-card-head:hover {
  background: hsl(var(--muted) / 0.3);
}

.boost-count-badge {
  font-size: 0.625rem;
  font-weight: 700;
  color: hsl(270 60% 68%);
}

.expand-chevron {
  font-size: 1.25rem;
  font-weight: 700;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: transform 0.2s;
  line-height: 1;
}

.expand-chevron.rotated {
  transform: rotate(90deg);
}

.boost-space-details {
  padding: 0 0.75rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  border-top: 1px solid hsl(var(--border) / 0.3);
  padding-top: 0.5rem;
  margin-top: 0;
}

.boost-subitem {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  border-radius: 0.375rem;
  transition: background 0.15s;
}

.boost-subitem:hover {
  background: hsl(var(--muted) / 0.3);
}

.unassigned-summary {
  border-radius: 0.625rem;
  border: 1px dashed hsl(270 40% 30% / 0.5);
  overflow: hidden;
}

.unassigned-summary-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
}

/* expand transition */
.expand-enter-active,
.expand-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 500px;
}

/* ═══════════ BOOST ACTIONS ═══════════ */
.boost-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

.boost-action-btn {
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0.3rem 0.625rem;
  border-radius: 0.375rem;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
  background: transparent;
  color: hsl(var(--muted-foreground));
  min-width: 4.5rem;
  text-align: center;
}

.boost-action-btn:hover { background: hsl(var(--muted) / 0.6); }
.boost-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.boost-action-btn:disabled:hover { background: transparent; }

.assign-btn {
  color: hsl(270 60% 65%);
  background: hsl(270 50% 20% / 0.25);
}
.assign-btn:hover { color: hsl(270 70% 70%); background: hsl(270 50% 20% / 0.4); }
.transfer-btn:hover { color: hsl(200 70% 60%); background: hsl(200 50% 20% / 0.3); }
.remove-btn:hover { color: hsl(0 65% 55%); background: hsl(0 50% 20% / 0.3); }

/* ═══════════ SPACE PICKER ═══════════ */
.space-picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: hsl(0 0% 0% / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
}

.space-picker {
  width: 340px;
  max-height: 420px;
  background: hsl(var(--popover));
  border: 1px solid hsl(var(--border));
  border-radius: 0.875rem;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: scaleIn 0.15s cubic-bezier(0.2, 0, 0, 1);
}

.space-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid hsl(var(--border));
}

.space-picker-title { font-size: 0.8125rem; font-weight: 700; }

.space-picker-close {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  border: none;
  background: hsl(var(--muted) / 0.4);
  color: hsl(var(--muted-foreground));
  font-size: 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s;
}

.space-picker-close:hover { background: hsl(var(--muted) / 0.8); }

.space-picker-input {
  margin: 0.5rem 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--input));
  color: hsl(var(--foreground));
  font-size: 0.8125rem;
  outline: none;
  transition: border-color 0.15s;
}

.space-picker-input:focus {
  border-color: hsl(270 60% 50% / 0.6);
  box-shadow: 0 0 0 2px hsl(270 60% 50% / 0.1);
}

.space-picker-input::placeholder { color: hsl(var(--muted-foreground)); }

.space-picker-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.25rem 0.5rem 0.5rem;
}

.space-picker-empty {
  padding: 1.5rem;
  text-align: center;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

.space-picker-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.5rem 0.625rem;
  border-radius: 0.5rem;
  border: none;
  background: transparent;
  color: hsl(var(--foreground));
  cursor: pointer;
  transition: background 0.1s;
}

.space-picker-item:hover { background: hsl(var(--accent)); }

.space-picker-name { font-size: 0.8125rem; font-weight: 500; }

.space-picker-boosts {
  margin-left: auto;
  font-size: 0.6875rem;
  color: hsl(270 60% 65%);
}

/* ═══════════ SHOP CARD ═══════════ */
.shop-variant {
  background: linear-gradient(160deg, hsl(var(--card) / 0.8), hsl(270 20% 8% / 0.9));
}

.shop-border {
  background: linear-gradient(90deg, transparent, hsl(270 70% 60% / 0.5), hsl(290 60% 55% / 0.3), transparent);
}

.ci-shop {
  background: linear-gradient(135deg, hsl(270 55% 22%), hsl(290 45% 25%));
  color: hsl(270 90% 75%);
  box-shadow: 0 2px 8px hsl(270 60% 35% / 0.35);
}

.boost-period-toggle {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 0.5rem;
  background: hsl(var(--muted) / 0.5);
}

.boost-period-toggle button {
  padding: 0.4rem 0.875rem;
  border-radius: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
  color: hsl(var(--muted-foreground));
  background: transparent;
  transition: all 0.2s;
}

.boost-period-toggle button.on {
  background: hsl(270 50% 22%);
  color: hsl(270 80% 78%);
  box-shadow: 0 2px 6px hsl(270 50% 20% / 0.3);
}

.pack-period-label {
  font-size: 0.625rem;
  color: hsl(var(--muted-foreground) / 0.7);
  font-weight: 500;
}

/* ═══════════ PACK CARDS ═══════════ */
.packs-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }

.pack-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.75rem 1rem 1.25rem;
  border-radius: 1rem;
  border: 1px solid hsl(var(--border));
  background: hsl(270 15% 8% / 0.3);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  min-height: 230px;
}

.pack-card:hover {
  border-color: hsl(270 50% 45% / 0.5);
  background: hsl(270 25% 11% / 0.5);
}

.pack-featured {
  border-color: hsl(270 50% 40% / 0.5);
  background: hsl(270 25% 11% / 0.4);
}

.pack-featured:hover {
  border-color: hsl(270 60% 50% / 0.6);
  box-shadow: 0 6px 20px hsl(270 50% 25% / 0.25);
}

.pack-best-badge {
  position: absolute;
  top: -0.5rem;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.5625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  background: linear-gradient(135deg, hsl(270 70% 50%), hsl(300 60% 45%));
  color: white;
  white-space: nowrap;
  box-shadow: 0 2px 8px hsl(270 60% 40% / 0.4);
}

.pack-rockets {
  display: flex;
  gap: 4px;
  color: hsl(270 70% 62%);
  margin-bottom: 0.25rem;
}

.pack-qty { font-size: 1.5rem; font-weight: 800; }
.pack-qty-label { font-size: 0.8125rem; font-weight: 600; opacity: 0.6; }
.pack-price { font-size: 1rem; font-weight: 700; color: hsl(var(--foreground)); }

.pack-per-unit {
  font-size: 0.6875rem;
  color: hsl(var(--muted-foreground) / 0.6);
}

.pack-savings {
  font-size: 0.625rem;
  font-weight: 700;
  color: hsl(150 60% 50%);
  background: hsl(150 50% 20% / 0.3);
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
}

.pack-buy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin-top: auto;
  padding: 0.55rem 1.125rem;
  border-radius: 0.5rem;
  border: none;
  font-size: 0.8125rem;
  font-weight: 700;
  color: white;
  background: linear-gradient(135deg, hsl(270 65% 45%), hsl(290 55% 40%));
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 6px hsl(270 60% 30% / 0.3);
  width: 100%;
  max-width: 130px;
}

.pack-buy-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px hsl(270 60% 30% / 0.4);
  background: linear-gradient(135deg, hsl(270 70% 50%), hsl(290 60% 45%));
}

.pack-buy-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

/* ═══════════ GIFT ═══════════ */
.gift-form { display: flex; flex-direction: column; gap: 0.875rem; }

.gift-field label {
  display: block;
  font-size: 0.6875rem;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  margin-bottom: 0.375rem;
}

.gift-input { height: 2.25rem; font-size: 0.8125rem; }

.gift-selected-friend {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem 0.375rem 0.375rem;
  border-radius: 2rem;
  background: hsl(270 50% 30% / 0.2);
  border: 1px solid hsl(270 60% 50% / 0.3);
  width: fit-content;
}

.gift-selected-name { font-size: 0.8125rem; font-weight: 500; color: hsl(var(--foreground)); }

.gift-selected-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  border: none;
  background: hsl(var(--muted) / 0.5);
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.1s;
}

.gift-selected-clear:hover {
  background: hsl(0 60% 50% / 0.3);
  color: hsl(0 80% 70%);
}

.friend-search-box { position: relative; }

.friend-search-input {
  width: 100%;
  height: 2.25rem;
  padding: 0 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--input));
  color: hsl(var(--foreground));
  font-size: 0.8125rem;
  outline: none;
  transition: border-color 0.15s;
}

.friend-search-input:focus {
  border-color: hsl(330 60% 50% / 0.6);
  box-shadow: 0 0 0 2px hsl(330 60% 50% / 0.1);
}

.friend-search-input::placeholder { color: hsl(var(--muted-foreground)); }

.friend-search-results {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 50;
  background: hsl(var(--popover));
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 4px;
  max-height: 220px;
  overflow-y: auto;
}

.friend-search-empty {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

.friend-search-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border-radius: 0.375rem;
  border: none;
  background: transparent;
  color: hsl(var(--foreground));
  cursor: pointer;
  transition: background 0.1s;
}

.friend-search-item:hover { background: hsl(var(--accent)); }
.friend-search-item-name { font-size: 0.8125rem; font-weight: 500; }
.friend-search-item-user { font-size: 0.6875rem; color: hsl(var(--muted-foreground)); margin-left: auto; }

.gift-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.375rem;
}

.gift-toggle {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 0.5rem;
  background: hsl(var(--muted) / 0.5);
}

.gift-toggle button {
  padding: 0.4rem 0.875rem;
  border-radius: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
  color: hsl(var(--muted-foreground));
  background: transparent;
  transition: all 0.2s;
}

.gift-toggle button.on {
  background: hsl(330 50% 22%);
  color: hsl(330 80% 78%);
  box-shadow: 0 2px 6px hsl(330 50% 20% / 0.3);
}

.gift-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1.125rem;
  border-radius: 0.5rem;
  border: none;
  font-size: 0.8125rem;
  font-weight: 700;
  color: white;
  background: linear-gradient(135deg, hsl(330 65% 42%), hsl(300 55% 38%));
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 3px 10px hsl(330 60% 28% / 0.3);
}

.gift-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 5px 16px hsl(330 60% 28% / 0.4);
}

.gift-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

/* ═══════════ TRANSITIONS ═══════════ */
.boost-item-enter-active,
.boost-item-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.boost-item-enter-from { opacity: 0; transform: translateX(-8px); }
.boost-item-leave-to { opacity: 0; transform: translateX(8px); }

.picker-fade-enter-active { transition: opacity 0.15s; }
.picker-fade-leave-active { transition: opacity 0.1s; }
.picker-fade-enter-from,
.picker-fade-leave-to { opacity: 0; }

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
</style>
