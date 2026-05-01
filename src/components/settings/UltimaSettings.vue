<template>
  <div class="ultima-page">
    <!-- Loading State -->
    <div v-if="ultima.loading" class="loader-wrap">
      <div class="loader-diamond">
        <svg viewBox="0 0 60 60" fill="none">
          <path d="M30 5L50 22L30 55L10 22L30 5Z" fill="url(#loaderFill)" stroke="url(#loaderStroke)" stroke-width="1.5"/>
          <defs>
            <linearGradient id="loaderFill" x1="10" y1="5" x2="50" y2="55">
              <stop stop-color="hsl(270 60% 40% / 0.6)"/><stop offset="1" stop-color="hsl(300 50% 30% / 0.3)"/>
            </linearGradient>
            <linearGradient id="loaderStroke" x1="10" y1="5" x2="50" y2="55">
              <stop stop-color="hsl(270 90% 75%)"/><stop offset="1" stop-color="hsl(300 70% 65%)"/>
            </linearGradient>
          </defs>
        </svg>
        <div class="loader-pulse" />
      </div>
    </div>

    <template v-else>
      <!-- ═══════════════════ HERO SECTION ═══════════════════ -->
      <div class="hero">
        <!-- Aurora Background -->
        <div class="hero-aurora">
          <div class="aurora-layer a1" />
          <div class="aurora-layer a2" />
          <div class="aurora-layer a3" />
        </div>

        <!-- Constellation Stars -->
        <svg class="constellation" viewBox="0 0 600 400" fill="none" preserveAspectRatio="xMidYMid slice">
          <!-- Stars -->
          <circle class="star s1" cx="80" cy="50" r="1.5" fill="white" />
          <circle class="star s2" cx="520" cy="80" r="1" fill="white" />
          <circle class="star s3" cx="150" cy="320" r="1.2" fill="white" />
          <circle class="star s4" cx="450" cy="300" r="1.5" fill="white" />
          <circle class="star s5" cx="300" cy="40" r="1" fill="white" />
          <circle class="star s6" cx="50" cy="200" r="0.8" fill="white" />
          <circle class="star s7" cx="550" cy="200" r="1.3" fill="white" />
          <circle class="star s8" cx="200" cy="100" r="0.7" fill="white" />
          <circle class="star s9" cx="400" cy="150" r="1" fill="white" />
          <circle class="star s10" cx="250" cy="350" r="0.9" fill="white" />
          <circle class="star s11" cx="100" cy="280" r="1.1" fill="white" />
          <circle class="star s12" cx="480" cy="350" r="0.8" fill="white" />
          <!-- Constellation lines -->
          <path class="const-line" d="M80 50L150 320" stroke="hsl(270 60% 60% / 0.08)" stroke-width="0.5"/>
          <path class="const-line" d="M520 80L450 300" stroke="hsl(270 60% 60% / 0.06)" stroke-width="0.5"/>
          <path class="const-line" d="M300 40L400 150" stroke="hsl(270 60% 60% / 0.07)" stroke-width="0.5"/>
          <path class="const-line" d="M200 100L250 350" stroke="hsl(270 60% 60% / 0.05)" stroke-width="0.5"/>
          <!-- Floating diamonds -->
          <path class="float-diamond fd1" d="M530 130l6-8-6-8-6 8z" fill="hsl(270 80% 70% / 0.4)" />
          <path class="float-diamond fd2" d="M70 320l5-7-5-7-5 7z" fill="hsl(300 70% 65% / 0.3)" />
          <path class="float-diamond fd3" d="M350 50l4-5.5-4-5.5-4 5.5z" fill="hsl(250 80% 75% / 0.35)" />
        </svg>

        <!-- Noise overlay -->
        <div class="noise-overlay" />

        <!-- Hero Content -->
        <div class="hero-inner">
          <template v-if="ultima.subscription">
            <!-- ═══ ACTIVE SUBSCRIBER ═══ -->
            <div class="sub-card">
              <div class="sub-card-glow" />

              <div class="sub-header">
                <div class="sub-emblem">
                  <svg viewBox="0 0 56 56" fill="none" class="emblem-svg">
                    <path d="M28 4L35 18L50 20L39 31L42 46L28 39L14 46L17 31L6 20L21 18L28 4Z" fill="url(#emblemGrad)" />
                    <path d="M28 4L35 18L50 20L39 31L42 46L28 39L14 46L17 31L6 20L21 18L28 4Z" stroke="url(#emblemStroke)" stroke-width="1" fill="none"/>
                    <path d="M28 14L32 22L40 23L34 29L36 37L28 33L20 37L22 29L16 23L24 22L28 14Z" fill="hsl(270 60% 80% / 0.3)" />
                    <defs>
                      <linearGradient id="emblemGrad" x1="6" y1="4" x2="50" y2="46">
                        <stop stop-color="hsl(270 70% 50%)"/><stop offset="1" stop-color="hsl(300 60% 40%)"/>
                      </linearGradient>
                      <linearGradient id="emblemStroke" x1="6" y1="4" x2="50" y2="46">
                        <stop stop-color="hsl(270 80% 75%)"/><stop offset="1" stop-color="hsl(300 70% 70%)"/>
                      </linearGradient>
                    </defs>
                  </svg>
                  <div class="emblem-ring r1" />
                  <div class="emblem-ring r2" />
                </div>

                <div class="sub-info">
                  <h3 class="sub-title">Ultima <span>{{ ultima.subscription.tier === UltimaPlan.Monthly ? t('ultima_monthly') : t('ultima_annual') }}</span></h3>
                  <Badge class="sub-badge-active">✓ {{ subscriptionStatusLabel }}</Badge>
                </div>
              </div>

              <div class="sub-metrics">
                <div class="metric">
                  <div class="metric-val">{{ formatDate(ultima.subscription.expiresAt) }}</div>
                  <div class="metric-lbl">{{ ultima.subscription.autoRenew ? t('ultima_renews') : t('ultima_expires') }}</div>
                </div>
                <div class="metric-sep" />
                <div class="metric">
                  <div class="metric-val">{{ ultima.subscription.usedBoostSlots }}<span class="metric-dim">/{{ ultima.subscription.totalBoostSlots }}</span></div>
                  <div class="metric-lbl">{{ t('ultima_boosts') }}</div>
                </div>
                <div class="metric-sep" />
                <div class="metric">
                  <div class="metric-val">{{ ultima.unassignedBoosts.length }}</div>
                  <div class="metric-lbl">{{ t('ultima_available') }}</div>
                </div>
              </div>

              <button
                v-if="ultima.subscription.status === UltimaSubscriptionStatus.Active"
                class="cancel-btn"
                @click="handleCancel"
                :disabled="cancelling"
              >
                <Loader2 v-if="cancelling" class="w-3.5 h-3.5 animate-spin" />
                <span>{{ t('ultima_cancel_sub') }}</span>
              </button>
            </div>
          </template>

          <template v-else>
            <!-- ═══ UPGRADE CTA ═══ -->
            <div class="cta">
              <!-- 3D Diamond -->
              <div class="diamond-scene">
                <div class="diamond-float">
                  <svg viewBox="0 0 120 140" fill="none" class="diamond-gem">
                    <!-- Main facets -->
                    <path d="M60 10L95 45L60 130L25 45L60 10Z" fill="url(#gemMain)"/>
                    <!-- Top facets -->
                    <path d="M60 10L95 45L60 50L25 45L60 10Z" fill="url(#gemTop)" opacity="0.9"/>
                    <!-- Internal refraction lines -->
                    <path d="M25 45L60 50L60 130Z" fill="hsl(270 50% 30% / 0.4)"/>
                    <path d="M95 45L60 50L60 130Z" fill="hsl(280 40% 25% / 0.3)"/>
                    <!-- Highlight edge -->
                    <path d="M60 10L40 30" stroke="hsl(270 90% 85% / 0.6)" stroke-width="1.5" stroke-linecap="round"/>
                    <path d="M25 45H95" stroke="hsl(270 70% 70% / 0.3)" stroke-width="0.75"/>
                    <path d="M60 10L80 32" stroke="hsl(270 70% 80% / 0.3)" stroke-width="0.75"/>
                    <!-- Sparkle points -->
                    <circle cx="38" cy="28" r="2" fill="white" opacity="0.7" class="gem-sparkle gs-a"/>
                    <circle cx="75" cy="38" r="1.5" fill="white" opacity="0.5" class="gem-sparkle gs-b"/>
                    <circle cx="55" cy="70" r="1" fill="white" opacity="0.3" class="gem-sparkle gs-c"/>
                    <defs>
                      <linearGradient id="gemMain" x1="25" y1="10" x2="95" y2="130">
                        <stop stop-color="hsl(270 70% 35%)"/>
                        <stop offset="0.4" stop-color="hsl(280 60% 28%)"/>
                        <stop offset="1" stop-color="hsl(300 50% 18%)"/>
                      </linearGradient>
                      <linearGradient id="gemTop" x1="25" y1="10" x2="95" y2="50">
                        <stop stop-color="hsl(270 80% 50%)"/>
                        <stop offset="1" stop-color="hsl(290 60% 35%)"/>
                      </linearGradient>
                    </defs>
                  </svg>
                  <!-- Light rays behind -->
                  <div class="diamond-rays" />
                </div>
                <!-- Ground reflection -->
                <div class="diamond-reflection" />
              </div>

              <h1 class="cta-title">
                <span class="holo-text">Ultima</span>
              </h1>
              <p class="cta-tagline">{{ t('ultima_tagline') }}</p>

              <!-- Perks Showcase -->
              <div class="perks-showcase">
                <div class="perk-card" v-for="perk in perks" :key="perk.label">
                  <div class="perk-glow" />
                  <div class="perk-emoji">{{ perk.emoji }}</div>
                  <div class="perk-label">{{ perk.label }}</div>
                  <div class="perk-desc">{{ perk.desc }}</div>
                </div>
              </div>

              <!-- Pricing Cards -->
              <div v-if="ultima.pricing" class="pricing-cards">
                <button
                  class="plan"
                  :class="{ active: selectedPlan === UltimaPlan.Monthly }"
                  @click="selectedPlan = UltimaPlan.Monthly"
                >
                  <div class="plan-border" />
                  <span class="plan-tier">{{ t('ultima_monthly') }}</span>
                  <span class="plan-amount">{{ ultima.pricing.subscriptionMonthly.amount }} <small class="plan-currency">{{ ultima.pricing.subscriptionMonthly.currency }}</small></span>
                  <span class="plan-cycle">{{ t('ultima_per_month') }}</span>
                </button>

                <button
                  class="plan"
                  :class="{ active: selectedPlan === UltimaPlan.Annual }"
                  @click="selectedPlan = UltimaPlan.Annual"
                >
                  <div class="plan-border" />
                  <div v-if="ultima.pricing.subscriptionAnnual.amountWithoutDiscount" class="plan-badge">{{ t('ultima_best_value') }}</div>
                  <span class="plan-tier">{{ t('ultima_annual') }}</span>
                  <span class="plan-amount">{{ ultima.pricing.subscriptionAnnual.amount }} <small class="plan-currency">{{ ultima.pricing.subscriptionAnnual.currency }}</small></span>
                  <span class="plan-cycle">{{ t('ultima_per_year') }}</span>
                  <span v-if="ultima.pricing.subscriptionAnnual.amountWithoutDiscount" class="plan-was">
                    {{ t('ultima_was', { amount: ultima.pricing.subscriptionAnnual.amountWithoutDiscount, currency: ultima.pricing.subscriptionAnnual.currency }) }}
                  </span>
                </button>
              </div>

              <!-- CTA Button -->
              <button class="cta-btn" @click="handleSubscribe" :disabled="checkingOut">
                <div class="cta-btn-shimmer" />
                <Loader2 v-if="checkingOut" class="w-5 h-5 animate-spin" />
                <template v-else>
                  <span>{{ t('ultima_get') }}</span>
                  <svg viewBox="0 0 20 20" fill="none" class="cta-btn-arrow"><path d="M4 10h12M12 6l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </template>
              </button>
            </div>
          </template>
        </div>
      </div>

    </template>

    <UltimaCheckoutDialog v-model:open="checkoutOpen" :checkout-url="checkoutUrl" :country-code="checkoutCountry" @completed="onCheckoutCompleted" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Badge } from "@argon/ui/badge";
import { useToast } from "@argon/ui/toast";
import { Loader2 } from "lucide-vue-next";
import { useUltimaStore } from "@/store/data/ultimaStore";
import {
  UltimaPlan,
  UltimaSubscriptionStatus,
  CheckoutError,
} from "@argon/glue";
import UltimaCheckoutDialog from "@/components/modals/UltimaCheckoutDialog.vue";
import { useLocale } from "@/store/system/localeStore";

const { t } = useLocale();
const ultima = useUltimaStore();
const { toast } = useToast();

onMounted(() => {
  ultima.fetchSubscription();
});

const selectedPlan = ref(UltimaPlan.Annual);
const checkingOut = ref(false);
const cancelling = ref(false);
const checkoutOpen = ref(false);
const checkoutUrl = ref("");
const checkoutCountry = ref("");

const perks = computed(() => [
  { emoji: "🎨", label: t('ultima_perk_avatars'), desc: t('ultima_perk_avatars_desc') },
  { emoji: "🚀", label: t('ultima_perk_boosts'), desc: t('ultima_perk_boosts_desc') },
  { emoji: "📁", label: t('ultima_perk_uploads'), desc: t('ultima_perk_uploads_desc') },
  { emoji: "💎", label: t('ultima_perk_badge'), desc: t('ultima_perk_badge_desc') },
  { emoji: "🎵", label: t('ultima_perk_audio'), desc: t('ultima_perk_audio_desc') },
  { emoji: "✨", label: t('ultima_perk_themes'), desc: t('ultima_perk_themes_desc') },
]);

const subscriptionStatusLabel = computed(() => {
  if (!ultima.subscription) return "";
  switch (ultima.subscription.status) {
    case UltimaSubscriptionStatus.Active: return t('ultima_status_active');
    case UltimaSubscriptionStatus.Cancelled: return t('ultima_status_cancelled');
    case UltimaSubscriptionStatus.Expired: return t('ultima_status_expired');
    case UltimaSubscriptionStatus.GracePeriod: return t('ultima_status_grace');
    default: return t('ultima_status_unknown');
  }
});

function formatDate(date: unknown): string {
  if (!date) return "—";
  // DateTimeOffset has { date: Date, offsetMinutes: number }
  const d = typeof date === "object" && date !== null && "date" in date ? (date as { date: Date }).date : new Date(date as string);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

async function handleSubscribe() {
  checkingOut.value = true;
  try {
    const result = await ultima.createCheckout(selectedPlan.value);
    if (result.success) {
      checkoutUrl.value = result.checkoutUrl;
      checkoutCountry.value = result.countryCode;
      checkoutOpen.value = true;
    } else {
      toast({ title: t('ultima_checkout_failed'), description: checkoutErrorMessage(result.error), variant: "destructive" });
    }
  } finally {
    checkingOut.value = false;
  }
}

async function handleCancel() {
  cancelling.value = true;
  try {
    const ok = await ultima.cancelSubscription();
    toast({ title: ok ? t('ultima_sub_cancelled') : t('ultima_sub_cancel_failed'), variant: ok ? undefined : "destructive" });
  } finally {
    cancelling.value = false;
  }
}

function onCheckoutCompleted() {
  checkoutOpen.value = false;
  ultima.fetchSubscription();
  toast({ title: t('ultima_payment_completed') });
}

function checkoutErrorMessage(error: CheckoutError): string {
  switch (error) {
    case CheckoutError.ALREADY_SUBSCRIBED: return t('ultima_err_already_subscribed');
    case CheckoutError.PAYMENT_ERROR: return t('ultima_err_payment');
    case CheckoutError.REGION_UNAVAILABLE: return t('ultima_err_region');
    default: return t('ultima_err_unknown');
  }
}
</script>

<style scoped>
/* ═══════════════════════════════════════════
   PAGE CONTAINER — centered
   ═══════════════════════════════════════════ */
.ultima-page {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
  padding: 1rem 0;
}

/* ═══════════ LOADER ═══════════ */
.loader-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

.loader-diamond {
  position: relative;
  width: 60px;
  height: 60px;
  animation: float 2s ease-in-out infinite;
}

.loader-diamond svg { width: 100%; height: 100%; }

.loader-pulse {
  position: absolute;
  inset: -12px;
  border-radius: 50%;
  background: radial-gradient(circle, hsl(270 70% 50% / 0.3), transparent 70%);
  animation: pulse-glow 1.5s ease-in-out infinite;
}

/* ═══════════ HERO ═══════════ */
.hero {
  position: relative;
  border-radius: 1.5rem;
  overflow: hidden;
  min-height: 480px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Aurora layers */
.hero-aurora {
  position: absolute;
  inset: 0;
  background: hsl(270 50% 4%);
  overflow: hidden;
}

.aurora-layer {
  position: absolute;
  width: 200%;
  height: 200%;
  top: -50%;
  left: -50%;
  border-radius: 40%;
}

.a1 {
  background: radial-gradient(ellipse at 30% 30%, hsl(270 80% 25% / 0.6), transparent 50%);
  animation: aurora 15s ease-in-out infinite;
}

.a2 {
  background: radial-gradient(ellipse at 70% 60%, hsl(300 70% 20% / 0.5), transparent 45%);
  animation: aurora 20s ease-in-out infinite reverse;
}

.a3 {
  background: radial-gradient(ellipse at 50% 80%, hsl(250 60% 20% / 0.4), transparent 40%);
  animation: aurora 25s ease-in-out infinite 5s;
}

/* Constellation */
.constellation {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.star {
  animation: twinkle 3s ease-in-out infinite;
}

.s1 { animation-delay: 0s; }
.s2 { animation-delay: 0.5s; }
.s3 { animation-delay: 1s; }
.s4 { animation-delay: 1.5s; }
.s5 { animation-delay: 2s; }
.s6 { animation-delay: 0.3s; }
.s7 { animation-delay: 0.8s; }
.s8 { animation-delay: 1.3s; }
.s9 { animation-delay: 1.8s; }
.s10 { animation-delay: 2.3s; }
.s11 { animation-delay: 0.6s; }
.s12 { animation-delay: 1.1s; }

.const-line {
  animation: fade-line 6s ease-in-out infinite;
}

.float-diamond {
  animation: drift 8s ease-in-out infinite;
}

.fd1 { animation-delay: 0s; }
.fd2 { animation-delay: 2.5s; }
.fd3 { animation-delay: 5s; }

/* Noise */
.noise-overlay {
  position: absolute;
  inset: 0;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  pointer-events: none;
}

/* Hero inner */
.hero-inner {
  position: relative;
  z-index: 10;
  width: 100%;
  padding: 2.5rem 2rem;
  display: flex;
  justify-content: center;
}

/* ═══ ACTIVE SUB CARD ═══ */
.sub-card {
  position: relative;
  width: 100%;
  max-width: 420px;
  padding: 2rem;
  border-radius: 1.25rem;
  background: hsl(270 30% 8% / 0.7);
  border: 1px solid hsl(270 40% 25% / 0.5);
  backdrop-filter: blur(20px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
}

.sub-card-glow {
  position: absolute;
  top: -1px;
  left: 20%;
  right: 20%;
  height: 1px;
  background: linear-gradient(90deg, transparent, hsl(270 80% 60% / 0.6), transparent);
}

.sub-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.sub-emblem {
  position: relative;
  width: 56px;
  height: 56px;
  flex-shrink: 0;
}

.emblem-svg {
  width: 100%;
  height: 100%;
}

.emblem-ring {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 1px solid hsl(270 60% 55% / 0.3);
}

.r1 { animation: ring-expand 3s ease-in-out infinite; }
.r2 { animation: ring-expand 3s ease-in-out infinite 1.5s; }

.sub-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.sub-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: white;
}

.sub-title span {
  color: hsl(270 80% 75%);
}

.sub-badge-active {
  width: fit-content;
  background: hsl(150 50% 20% / 0.5);
  border: 1px solid hsl(150 50% 40% / 0.4);
  color: hsl(150 70% 70%);
  font-size: 0.6875rem;
}

.sub-metrics {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 1rem 1.5rem;
  border-radius: 0.875rem;
  background: hsl(270 25% 10% / 0.6);
  border: 1px solid hsl(270 25% 18% / 0.5);
}

.metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.metric-val {
  font-size: 0.9375rem;
  font-weight: 700;
  color: hsl(270 80% 85%);
}

.metric-dim { color: hsl(270 30% 40%); }

.metric-lbl {
  font-size: 0.5625rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: hsl(270 20% 45%);
}

.metric-sep {
  width: 1px;
  height: 28px;
  background: hsl(270 25% 25% / 0.5);
}

.cancel-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.6875rem;
  color: hsl(270 15% 42%);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.2s;
}

.cancel-btn:hover { color: hsl(0 55% 55%); }

/* ═══ CTA (NO SUB) ═══ */
.cta {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  width: 100%;
}

/* 3D Diamond Scene */
.diamond-scene {
  position: relative;
  margin-bottom: 2rem;
}

.diamond-float {
  position: relative;
  animation: gem-float 5s ease-in-out infinite;
}

.diamond-gem {
  width: 100px;
  height: 120px;
  filter: drop-shadow(0 20px 40px hsl(270 70% 30% / 0.5));
}

.diamond-rays {
  position: absolute;
  inset: -30px;
  border-radius: 50%;
  background: radial-gradient(circle, hsl(270 80% 55% / 0.15), transparent 60%);
  animation: pulse-glow 4s ease-in-out infinite;
}

.diamond-reflection {
  width: 60px;
  height: 8px;
  margin: 0 auto;
  margin-top: -4px;
  border-radius: 50%;
  background: radial-gradient(ellipse, hsl(270 60% 50% / 0.2), transparent 70%);
  filter: blur(3px);
  animation: gem-float 5s ease-in-out infinite reverse;
}

.gem-sparkle { animation: twinkle 2s ease-in-out infinite; }
.gs-a { animation-delay: 0s; }
.gs-b { animation-delay: 0.7s; }
.gs-c { animation-delay: 1.4s; }

/* Title */
.cta-title {
  font-size: 3rem;
  font-weight: 900;
  letter-spacing: -0.03em;
  margin-bottom: 0.5rem;
  line-height: 1;
}

.holo-text {
  background: linear-gradient(
    135deg,
    hsl(270 90% 75%) 0%,
    hsl(290 80% 80%) 20%,
    hsl(320 70% 85%) 35%,
    white 50%,
    hsl(250 80% 80%) 65%,
    hsl(270 90% 75%) 80%,
    hsl(300 80% 80%) 100%
  );
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: holo-shift 5s ease-in-out infinite;
}

.cta-tagline {
  font-size: 1rem;
  color: hsl(270 20% 50%);
  margin-bottom: 2.5rem;
}

/* Perks */
.perks-showcase {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.625rem;
  margin-bottom: 2.5rem;
  width: 100%;
  max-width: 480px;
}

.perk-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 1rem 0.5rem;
  border-radius: 0.75rem;
  background: hsl(270 25% 10% / 0.5);
  border: 1px solid hsl(270 30% 20% / 0.4);
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.perk-card:hover {
  border-color: hsl(270 50% 40% / 0.6);
  transform: translateY(-3px);
  box-shadow: 0 8px 24px hsl(270 50% 20% / 0.3);
}

.perk-card:hover .perk-glow {
  opacity: 1;
}

.perk-glow {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, hsl(270 80% 65% / 0.5), transparent);
  opacity: 0;
  transition: opacity 0.3s;
}

.perk-emoji {
  font-size: 1.25rem;
  margin-bottom: 0.25rem;
}

.perk-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: hsl(270 30% 75%);
}

.perk-desc {
  font-size: 0.5625rem;
  color: hsl(270 15% 42%);
}

/* Pricing */
.pricing-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.875rem;
  width: 100%;
  max-width: 380px;
  margin-bottom: 2rem;
}

.plan {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.125rem;
  padding: 1.5rem 1rem;
  border-radius: 1rem;
  border: 1.5px solid hsl(270 25% 18%);
  background: hsl(270 20% 8% / 0.7);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.plan-border {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1.5px;
  background: conic-gradient(from 0deg, transparent, hsl(270 70% 50%), transparent, hsl(300 60% 50%), transparent);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.3s;
}

.plan:hover .plan-border,
.plan.active .plan-border {
  opacity: 1;
  animation: rotate-border 4s linear infinite;
}

.plan:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 32px hsl(270 60% 20% / 0.3);
}

.plan.active {
  border-color: hsl(270 70% 50%);
  background: hsl(270 35% 12% / 0.9);
  box-shadow:
    0 0 0 1px hsl(270 70% 55% / 0.2),
    0 12px 40px hsl(270 70% 35% / 0.25);
}

.plan-badge {
  position: absolute;
  top: -1px;
  right: -1px;
  padding: 4px 10px;
  border-radius: 0 1rem 0 0.5rem;
  font-size: 0.5rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  background: linear-gradient(135deg, hsl(150 75% 40%), hsl(170 65% 35%));
  color: white;
}

.plan-tier {
  font-size: 0.6875rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: hsl(270 20% 50%);
}

.plan-amount {
  font-size: 2rem;
  font-weight: 900;
  color: white;
  line-height: 1.1;
}

.plan-currency {
  font-size: 0.75rem;
  font-weight: 600;
  opacity: 0.6;
  vertical-align: super;
}

.plan-cycle {
  font-size: 0.6875rem;
  color: hsl(270 15% 40%);
}

.plan-was {
  font-size: 0.625rem;
  color: hsl(270 15% 35%);
  text-decoration: line-through;
  margin-top: 0.125rem;
}

/* CTA Button */
.cta-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  padding: 1rem 3rem;
  border-radius: 0.875rem;
  border: none;
  font-size: 1rem;
  font-weight: 800;
  color: white;
  background: linear-gradient(135deg, hsl(270 75% 50%), hsl(290 65% 45%), hsl(310 60% 42%));
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow:
    0 4px 16px hsl(270 60% 40% / 0.4),
    inset 0 1px 0 hsl(270 80% 70% / 0.2);
  overflow: hidden;
}

.cta-btn-shimmer {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, hsl(0 0% 100% / 0.15), transparent);
  animation: btn-shimmer 3s ease-in-out infinite;
}

.cta-btn:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow:
    0 8px 32px hsl(270 60% 40% / 0.5),
    inset 0 1px 0 hsl(270 80% 70% / 0.3);
}

.cta-btn:active {
  transform: translateY(0) scale(0.98);
}

.cta-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.cta-btn-arrow {
  width: 20px;
  height: 20px;
  transition: transform 0.25s;
}

.cta-btn:hover .cta-btn-arrow {
  transform: translateX(4px);
}

/* ═══════════ KEYFRAMES ═══════════ */
@keyframes aurora {
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  33% { transform: translate(5%, 3%) rotate(2deg); }
  66% { transform: translate(-3%, -2%) rotate(-1deg); }
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

@keyframes gem-float {
  0%, 100% { transform: translateY(0) rotateY(0deg); }
  25% { transform: translateY(-6px) rotateY(3deg); }
  50% { transform: translateY(-12px) rotateY(0deg); }
  75% { transform: translateY(-6px) rotateY(-3deg); }
}

@keyframes drift {
  0%, 100% { transform: translate(0, 0); opacity: 0.5; }
  25% { transform: translate(6px, -10px); opacity: 0.9; }
  50% { transform: translate(-4px, -16px); opacity: 0.3; }
  75% { transform: translate(10px, -6px); opacity: 0.8; }
}

@keyframes twinkle {
  0%, 100% { opacity: 0.2; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.3); }
}

@keyframes holo-shift {
  0% { background-position: 0% center; }
  50% { background-position: 300% center; }
  100% { background-position: 0% center; }
}

@keyframes pulse-glow {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.08); }
}

@keyframes ring-expand {
  0% { transform: scale(1); opacity: 0.5; }
  100% { transform: scale(1.4); opacity: 0; }
}

@keyframes rotate-border {
  to { transform: rotate(360deg); }
}

@keyframes btn-shimmer {
  0% { left: -100%; }
  50%, 100% { left: 100%; }
}

@keyframes fade-line {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
