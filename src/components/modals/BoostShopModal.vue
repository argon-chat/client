<template>
  <Dialog v-model:open="open">
    <DialogContent class="boost-shop-dialog max-w-lg p-0 overflow-hidden">
      <div class="shop-inner">
        <div class="shop-header">
          <div class="card-icon ci-shop">
            <ShoppingBagIcon class="w-5 h-5" />
          </div>
          <div class="flex-1 min-w-0">
            <DialogTitle class="card-title">{{ t('ultima_boost_shop_title') }}</DialogTitle>
            <DialogDescription class="card-subtitle">{{ t('ultima_boost_shop_subtitle') }}</DialogDescription>
          </div>
          <div class="boost-period-toggle">
            <button :class="{ on: boostPeriod === 'monthly' }" @click="boostPeriod = 'monthly'">{{ t('ultima_boost_monthly') }}</button>
            <button :class="{ on: boostPeriod === 'annual' }" @click="boostPeriod = 'annual'">{{ t('ultima_boost_annual') }}</button>
          </div>
        </div>

        <div v-if="!ultima.pricing" class="flex items-center justify-center py-10">
          <Loader2 class="w-6 h-6 animate-spin text-violet-400" />
        </div>

        <div v-else class="packs-row">
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
            <button class="pack-buy-btn" :disabled="purchasingPack !== null" @click="handlePurchase(pack.type)">
              <Loader2 v-if="purchasingPack === pack.type" class="w-4 h-4 animate-spin" />
              <ShoppingBagIcon v-else class="w-4 h-4" />
              {{ t('ultima_boost_buy') }}
            </button>
          </div>
        </div>
      </div>

      <UltimaCheckoutDialog v-model:open="checkoutOpen" :checkout-url="checkoutUrl" :country-code="checkoutCountry" mode="one-time" @completed="onCheckoutCompleted" />
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@argon/ui/dialog";
import { Loader2, RocketIcon, ShoppingBagIcon } from "lucide-vue-next";
import { useUltimaStore } from "@/store/data/ultimaStore";
import { useToast } from "@argon/ui/toast";
import { BoostPackType, PurchaseBoostError } from "@argon/glue";
import UltimaCheckoutDialog from "@/components/modals/UltimaCheckoutDialog.vue";
import { useLocale } from "@/store/system/localeStore";

const { t } = useLocale();
const ultima = useUltimaStore();
const { toast } = useToast();

const open = defineModel<boolean>("open", { default: false });

const emit = defineEmits<{
  purchased: [];
}>();

const checkoutOpen = ref(false);
const checkoutUrl = ref("");
const checkoutCountry = ref("");
const purchasingPack = ref<BoostPackType | null>(null);
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

async function handlePurchase(pack: BoostPackType) {
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

function onCheckoutCompleted() {
  checkoutOpen.value = false;
  ultima.fetchBoosts();
  toast({ title: t('ultima_payment_completed') });
  emit("purchased");
  open.value = false;
}
</script>

<style scoped>
.boost-shop-dialog {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
}

.shop-inner {
  padding: 1.5rem;
}

.shop-header {
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

.ci-shop {
  background: linear-gradient(135deg, hsl(270 55% 22%), hsl(290 45% 25%));
  color: hsl(270 90% 75%);
  box-shadow: 0 2px 8px hsl(270 60% 35% / 0.35);
}

.card-title { font-size: 1.0625rem; font-weight: 700; }
.card-subtitle { font-size: 0.6875rem; color: hsl(var(--muted-foreground)); }

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

.pack-period-label {
  font-size: 0.625rem;
  color: hsl(var(--muted-foreground) / 0.7);
  font-weight: 500;
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
</style>
