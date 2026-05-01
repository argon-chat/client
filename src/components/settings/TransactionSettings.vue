<template>
  <div class="transactions-page">
    <div v-if="loading" class="loader-wrap">
      <Loader2 class="w-8 h-8 animate-spin text-violet-400" />
    </div>

    <template v-else>
      <!-- ═══════════════════ PAYMENT METHOD ═══════════════════ -->
      <div v-if="ultima.subscription?.paymentAccount" class="glass-card">
        <div class="glass-card-border" />
        <div class="card-head">
          <div class="card-icon ci-card">
            <CreditCardIcon class="w-5 h-5" />
          </div>
          <div>
            <h3 class="card-title">{{ t('ultima_tx_payment_method') }}</h3>
            <p class="card-subtitle">{{ t('ultima_tx_payment_method_desc') }}</p>
          </div>
        </div>

        <div class="payment-card-visual">
          <div class="payment-card-chip" />
          <div class="payment-card-type">{{ ultima.subscription.paymentAccount.cardType ?? t('ultima_tx_card') }}</div>
          <div class="payment-card-number">•••• •••• •••• {{ ultima.subscription.paymentAccount.cardLastFour ?? '••••' }}</div>
          <div class="payment-card-expiry" v-if="ultima.subscription.paymentAccount.expiryMonth && ultima.subscription.paymentAccount.expiryYear">
            {{ ultima.subscription.paymentAccount.expiryMonth }}/{{ ultima.subscription.paymentAccount.expiryYear }}
          </div>
        </div>
      </div>

      <!-- ═══════════════════ TRANSACTIONS ═══════════════════ -->
      <div class="glass-card">
        <div class="glass-card-border" />
        <div class="card-head">
          <div class="card-icon ci-history">
            <ReceiptIcon class="w-5 h-5" />
          </div>
          <div>
            <h3 class="card-title">{{ t('ultima_tx_history') }}</h3>
            <p class="card-subtitle">{{ t('ultima_tx_history_desc') }}</p>
          </div>
        </div>

        <div v-if="ultima.transactions.length === 0" class="empty-state">
          <ReceiptIcon class="w-10 h-10 text-muted-foreground/30" />
          <p class="empty-label">{{ t('ultima_tx_no_transactions') }}</p>
          <p class="empty-hint">{{ t('ultima_tx_no_transactions_hint') }}</p>
        </div>

        <div v-else class="tx-list">
          <div
            v-for="tx in ultima.transactions"
            :key="tx.paymentId"
            class="tx-item"
          >
            <div class="tx-icon-wrap" :class="txIconClass(tx)">
              <component :is="txIcon(tx)" class="w-4 h-4" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="tx-label">{{ txLabel(tx) }}</p>
              <p class="tx-date">
                {{ formatDate(tx.date) }}
                <span v-if="tx.cardBrand || tx.cardSuffix" class="tx-card-info">· {{ tx.cardBrand }} •••• {{ tx.cardSuffix }}</span>
              </p>
            </div>
            <div class="tx-right">
              <div class="tx-amount" v-if="tx.amount">
                {{ tx.amount }} {{ tx.currency }}
              </div>
              <div v-if="tx.status" class="tx-status" :class="'tx-status-' + tx.status">{{ tx.status }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Loader2, CreditCardIcon, ReceiptIcon, RocketIcon, GiftIcon, CrownIcon } from "lucide-vue-next";
import { useUltimaStore } from "@/store/data/ultimaStore";
import type { UltimaTransaction } from "@argon/glue";
import { useLocale } from "@/store/system/localeStore";

const { t } = useLocale();
const ultima = useUltimaStore();
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    await Promise.all([ultima.fetchTransactions(), ultima.fetchSubscription()]);
  } finally {
    loading.value = false;
  }
});

function formatDate(date: unknown): string {
  if (!date) return "—";
  const d = typeof date === "object" && date !== null && "date" in date ? (date as { date: Date }).date : new Date(date as string);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function txLabel(tx: UltimaTransaction): string {
  if (tx.transactionType === "gift") return t('ultima_tx_type_gift');
  if (tx.boostPackType) {
    const count = tx.boostCount ?? 0;
    return t('ultima_tx_type_boost', { count });
  }
  if (tx.planExternalId) return t('ultima_tx_type_subscription');
  return t('ultima_tx_type_payment');
}

function txIcon(tx: UltimaTransaction) {
  if (tx.transactionType === "gift") return GiftIcon;
  if (tx.boostPackType) return RocketIcon;
  return CrownIcon;
}

function txIconClass(tx: UltimaTransaction): string {
  if (tx.transactionType === "gift") return "tx-gift";
  if (tx.boostPackType) return "tx-boost";
  return "tx-sub";
}
</script>

<style scoped>
.transactions-page {
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
  background: linear-gradient(90deg, transparent, hsl(270 60% 55% / 0.3), transparent);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-bottom: 1.5rem;
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

.ci-card {
  background: linear-gradient(135deg, hsl(210 50% 18%), hsl(210 40% 22%));
  color: hsl(210 80% 70%);
  box-shadow: 0 2px 8px hsl(210 50% 30% / 0.3);
}

.ci-history {
  background: linear-gradient(135deg, hsl(270 50% 18%), hsl(270 40% 22%));
  color: hsl(270 80% 70%);
  box-shadow: 0 2px 8px hsl(270 50% 30% / 0.3);
}

.card-title { font-size: 1.0625rem; font-weight: 700; }
.card-subtitle { font-size: 0.6875rem; color: hsl(var(--muted-foreground)); }

/* ═══════════ PAYMENT CARD VISUAL ═══════════ */
.payment-card-visual {
  position: relative;
  width: 320px;
  height: 190px;
  border-radius: 1rem;
  padding: 1.5rem;
  background: linear-gradient(135deg, hsl(230 30% 14%), hsl(260 25% 18%), hsl(280 20% 14%));
  border: 1px solid hsl(260 30% 25% / 0.5);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: 0 8px 32px hsl(260 40% 10% / 0.5);
}

.payment-card-chip {
  width: 36px;
  height: 28px;
  border-radius: 5px;
  background: linear-gradient(135deg, hsl(45 60% 55%), hsl(35 50% 45%));
  opacity: 0.8;
}

.payment-card-type {
  position: absolute;
  top: 1.5rem;
  right: 1.5rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: hsl(0 0% 100% / 0.5);
}

.payment-card-number {
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  color: hsl(0 0% 100% / 0.85);
  font-family: "Courier New", monospace;
}

.payment-card-expiry {
  font-size: 0.75rem;
  color: hsl(0 0% 100% / 0.5);
  letter-spacing: 0.05em;
}

/* ═══════════ EMPTY ═══════════ */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2.5rem 1rem;
  text-align: center;
  gap: 0.5rem;
}

.empty-label { font-size: 0.875rem; font-weight: 500; color: hsl(var(--muted-foreground)); }
.empty-hint { font-size: 0.75rem; color: hsl(var(--muted-foreground) / 0.5); }

/* ═══════════ TRANSACTION LIST ═══════════ */
.tx-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.tx-item {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.75rem 0.875rem;
  border-radius: 0.625rem;
  transition: background 0.15s;
}

.tx-item:hover { background: hsl(var(--muted) / 0.4); }

.tx-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tx-sub {
  background: hsl(270 40% 15%);
  color: hsl(270 70% 65%);
}

.tx-boost {
  background: hsl(270 40% 15%);
  color: hsl(270 80% 70%);
}

.tx-gift {
  background: hsl(330 40% 15%);
  color: hsl(330 70% 65%);
}

.tx-label { font-size: 0.8125rem; font-weight: 550; }
.tx-date { font-size: 0.6875rem; color: hsl(var(--muted-foreground)); }

.tx-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
  flex-shrink: 0;
}

.tx-amount {
  font-size: 0.875rem;
  font-weight: 700;
  color: hsl(var(--foreground));
  white-space: nowrap;
}

.tx-card-info {
  color: hsl(var(--muted-foreground) / 0.6);
}

.tx-status {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  background: hsl(var(--muted) / 0.5);
  color: hsl(var(--muted-foreground));
}

.tx-status-done,
.tx-status-paid,
.tx-status-successful {
  background: hsl(145 40% 15%);
  color: hsl(145 60% 60%);
}

.tx-status-pending,
.tx-status-processing {
  background: hsl(45 40% 15%);
  color: hsl(45 70% 60%);
}

.tx-status-failed,
.tx-status-canceled,
.tx-status-refunded {
  background: hsl(0 40% 15%);
  color: hsl(0 60% 60%);
}
</style>
