<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-[720px] w-[95vw] h-[85vh] p-0 overflow-hidden flex flex-col checkout-dialog-content" @interactOutside.prevent @pointerDownOutside.prevent @escapeKeyDown.prevent>
      <DialogHeader class="p-4 pb-2 flex-shrink-0 checkout-header">
        <DialogTitle class="checkout-title">{{ t('ultima_checkout_title') }}</DialogTitle>
      </DialogHeader>

      <div class="flex-1 relative min-h-0 overflow-y-auto xsolla-checkout-container">
        <!-- Loading state -->
        <div v-if="state === 'loading'" class="absolute inset-0 flex items-center justify-center bg-background/80 z-10 checkout-loading">
          <div class="checkout-spinner">
            <Loader2 class="w-10 h-10 animate-spin text-violet-400" />
          </div>
          <p class="text-xs text-muted-foreground mt-3 animate-pulse">{{ t('ultima_checkout_init') }}</p>
        </div>

        <!-- Error state -->
        <div v-if="state === 'error'" class="flex flex-col items-center justify-center h-full gap-4 p-6 checkout-error-state">
          <div class="checkout-error-icon">
            <XCircle class="w-14 h-14 text-red-400" />
          </div>
          <p class="text-sm text-muted-foreground text-center">{{ errorMessage }}</p>
        </div>

        <!-- SDK components only mount after successful init -->
        <template v-if="sdkReady">
          <!-- Payment methods selection -->
          <div v-show="state === 'methods'" class="checkout-methods-view">
            <div class="checkout-methods-top">
              <psdk-payment-methods ref="paymentMethodsEl" :country="props.countryCode" />
              <psdk-finance-details />
              <psdk-total />
            </div>
            <div class="checkout-methods-bottom">
              <psdk-legal />
            </div>
          </div>

          <!-- Payment form (after method selected) -->
          <div v-show="state === 'form'" class="p-5 space-y-5 checkout-form-view">
            <div class="checkout-form-card">
              <div class="checkout-form-card-header">
                <span class="checkout-form-card-icon">💳</span>
                <span class="checkout-form-card-title">{{ t('ultima_checkout_card_details') }}</span>
                <div class="coupon-inline">
                  <input
                    v-model="couponCode"
                    class="coupon-input"
                    :placeholder="t('ultima_checkout_coupon_placeholder')"
                    :disabled="couponApplied"
                    @keydown.enter="applyCoupon"
                  />
                  <button
                    v-if="!couponApplied"
                    class="coupon-apply-btn"
                    :disabled="!couponCode.trim() || couponLoading"
                    @click="applyCoupon"
                  >
                    <Loader2 v-if="couponLoading" class="w-3.5 h-3.5 animate-spin" />
                    <span v-else>{{ t('ultima_checkout_coupon_apply') }}</span>
                  </button>
                  <button
                    v-else
                    class="coupon-remove-btn"
                    @click="removeCoupon"
                  >
                    {{ t('ultima_checkout_coupon_remove') }}
                  </button>
                </div>
              </div>
              <p v-if="couponError" class="coupon-error coupon-msg">{{ couponError }}</p>
              <p v-if="couponApplied && couponDiscount" class="coupon-success coupon-msg">{{ t('ultima_checkout_coupon_applied', { discount: couponDiscount }) }}</p>
              <psdk-payment-form />
            </div>
            <psdk-payment-form-messages />
            <div class="checkout-summary-card">
              <psdk-finance-details />
              <div class="checkout-total-row">
                <psdk-total />
              </div>
              <div class="checkout-submit-row">
                <psdk-submit-button />
              </div>
            </div>
            <psdk-legal />
          </div>

          <!-- 3DS / Redirect -->
          <div v-show="state === '3ds'" class="checkout-3ds-container">
            <div ref="threeDsContainer"></div>
          </div>
          <div v-show="state === 'redirect'" class="checkout-redirect-container">
            <div ref="redirectContainer"></div>
          </div>

          <!-- Status -->
          <div v-show="state === 'status'" class="flex flex-col items-center justify-center h-full gap-6 p-6 checkout-status-view">
            <psdk-status />
          </div>
        </template>
      </div>

      <div class="p-3 flex items-center justify-end border-t border-border/50 flex-shrink-0 checkout-footer">
        <div class="flex gap-2">
          <Button v-if="state === 'form'" variant="ghost" size="sm" @click="state = 'methods'" class="checkout-back-btn">
            {{ t('ultima_checkout_back') }}
          </Button>
          <Button variant="ghost" size="sm" @click="handleClose">{{ t('cancel') }}</Button>
          <Button v-if="state === 'status'" size="sm" @click="handleDone">
            {{ t('ultima_checkout_done') }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick } from "vue";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { Loader2, XCircle, TicketIcon } from "lucide-vue-next";
import { useUltimaStore } from "@/store/data/ultimaStore";
import { useLocale } from "@/store/system/localeStore";
import { headlessCheckout, NextActionType } from "@xsolla/pay-station-sdk";
import type { EventName } from "@xsolla/pay-station-sdk";
import "@xsolla/pay-station-sdk/dist/style.css";
import { logger } from "@argon/core";

const props = withDefaults(defineProps<{
  checkoutUrl: string;
  countryCode: string;
  mode?: "subscription" | "one-time";
}>(), {
  mode: "subscription",
});

const emit = defineEmits<{
  completed: [];
}>();

const open = defineModel<boolean>("open", { default: false });

const ultima = useUltimaStore();
const localeStore = useLocale();
const { t } = localeStore;
const state = ref<"loading" | "methods" | "form" | "3ds" | "redirect" | "status" | "error">("loading");
const errorMessage = ref("");
const sdkReady = ref(false);
let hasError = false;
const paymentMethodsEl = ref<HTMLElement>();
const threeDsContainer = ref<HTMLElement>();
const redirectContainer = ref<HTMLElement>();

let unsubNextAction: (() => void) | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let fieldsAbortController: AbortController | null = null;

// Coupon state
const couponCode = ref("");
const couponLoading = ref(false);
const couponApplied = ref(false);
const couponError = ref("");
const couponDiscount = ref("");

function applyCoupon() {
  const code = couponCode.value.trim();
  if (!code) return;
  couponLoading.value = true;
  couponError.value = "";
  headlessCheckout.events.send(
    { name: "applyCoupon" as EventName, data: { code } },
    (msg: any) => ({ isHandled: msg?.name === "applyCoupon", value: msg?.data })
  );
}

function removeCoupon() {
  headlessCheckout.events.send(
    { name: "removeCoupon" as EventName },
    (msg: any) => ({ isHandled: msg?.name === "removeCoupon", value: msg?.data })
  );
}

function setupCouponListener() {
  headlessCheckout.events.onCoreEvent(
    "couponUpdate" as EventName,
    (msg: any) => ({ isHandled: msg?.name === "couponUpdate", value: msg?.data }),
    (value: any) => {
    couponLoading.value = false;
    if (value === null || value === undefined) {
      // Coupon removed
      couponApplied.value = false;
      couponDiscount.value = "";
      couponCode.value = "";
      return;
    }
    if (value.isValid) {
      couponApplied.value = true;
      couponError.value = "";
      couponDiscount.value = value.discount?.amount
        ? `${value.discount.amount} ${value.discount.currency}`
        : "";
    } else {
      couponApplied.value = false;
      couponError.value = value.errorMessage || t('ultima_checkout_coupon_invalid');
    }
  });
}

function resetCouponState() {
  couponCode.value = "";
  couponLoading.value = false;
  couponApplied.value = false;
  couponError.value = "";
  couponDiscount.value = "";
}

function extractToken(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("token");
  } catch {
    if (url && !url.startsWith("http")) return url;
    return null;
  }
}

function watchIframeReturn(iframe: HTMLIFrameElement) {
  let loadCount = 0;
  iframe.addEventListener("load", () => {
    loadCount++;
    // Skip the initial load (blank or first navigation to 3DS/redirect page)
    if (loadCount <= 1) return;
    try {
      const iframeUrl = iframe.contentWindow?.location?.href;
      if (iframeUrl && iframeUrl.startsWith(window.location.origin)) {
        // Iframe navigated back to our app — 3DS/redirect complete
        iframe.style.display = "none";
        state.value = "status";
        startCompletionPolling();
      }
    } catch {
      // Cross-origin — still on external page, ignore
    }
  });
}

async function initCheckout() {
  state.value = "loading";
  sdkReady.value = false;
  hasError = false;
  errorMessage.value = "";

  const token = extractToken(props.checkoutUrl);
  if (!token) {
    state.value = "error";
    errorMessage.value = t("ultima_invalid_token");
    return;
  }

  try {
    const isWebview = "windowManagement" in window;

    await headlessCheckout.init({
      isWebview,
      sandbox: true,
      theme: "default",
      language: localeStore.currentLocale as any,
    });

    await headlessCheckout.setToken(token);

    // Style secure iframe inputs (card number, phone) for dark theme
    await headlessCheckout.setSecureComponentStyles(`
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 0;
        background: transparent !important;
      }
      input {
        background-color: transparent !important;
        color: #e4e4e7 !important;
        border: none !important;
        padding: 10px 12px;
        font-size: 14px;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
        width: 100%;
        outline: none;
        caret-color: #a78bfa;
        letter-spacing: 0.01em;
      }
      input::placeholder {
        color: #52525b !important;
      }
    `);

    // Listen for next actions (3DS, redirect, errors)
    unsubNextAction = headlessCheckout.form.onNextAction((action) => {
      logger.warn("[Checkout] nextAction:", action.type, JSON.stringify(action));
      switch (action.type) {
        case NextActionType.redirect: {
          state.value = "redirect";
          nextTick(() => {
            if (redirectContainer.value) {
              redirectContainer.value.innerHTML = "";
              const redirectData = (action as any).data?.redirect ?? (action as any).data;
              const url = redirectData.redirectUrl;
              const method = (redirectData.method || "GET").toUpperCase();
              const formData = redirectData.data || {};

              // Create an iframe and submit the redirect form into it
              const iframe = document.createElement("iframe");
              iframe.name = "checkout-redirect-frame";
              iframe.style.width = "100%";
              iframe.style.height = "100%";
              iframe.style.minHeight = "400px";
              iframe.style.border = "none";
              iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-top-navigation-by-user-activation allow-popups");
              watchIframeReturn(iframe);
              redirectContainer.value.appendChild(iframe);

              if (method === "GET") {
                const params = new URLSearchParams();
                for (const [key, val] of Object.entries(formData)) {
                  params.set(key, val as string);
                }
                const separator = url.includes("?") ? "&" : "?";
                iframe.src = params.toString() ? `${url}${separator}${params.toString()}` : url;
              } else {
                // POST: create a form that targets the iframe
                const form = document.createElement("form");
                form.method = "POST";
                form.action = url;
                form.target = "checkout-redirect-frame";
                form.style.display = "none";
                for (const [key, val] of Object.entries(formData)) {
                  const input = document.createElement("input");
                  input.type = "hidden";
                  input.name = key;
                  input.value = val as string;
                  form.appendChild(input);
                }
                redirectContainer.value.appendChild(form);
                form.submit();
              }
            }
          });
          break;
        }
        case NextActionType.threeDS: {
          state.value = "3ds";
          nextTick(() => {
            if (threeDsContainer.value) {
              threeDsContainer.value.innerHTML = "";
              const challengeData = (action as any).data;
              // Render 3DS challenge in an iframe to prevent Electron tab navigation
              const iframe = document.createElement("iframe");
              iframe.name = "checkout-3ds-frame";
              iframe.style.width = "100%";
              iframe.style.height = "100%";
              iframe.style.minHeight = "400px";
              iframe.style.border = "none";
              iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-top-navigation-by-user-activation allow-popups");
              watchIframeReturn(iframe);
              threeDsContainer.value.appendChild(iframe);

              // 3DS challenge is typically a POST form
              if (challengeData.url || challengeData.acsUrl) {
                const url = challengeData.url || challengeData.acsUrl;
                const form = document.createElement("form");
                form.method = "POST";
                form.action = url;
                form.target = "checkout-3ds-frame";
                form.style.display = "none";
                // Add all challenge params as hidden fields
                const params = challengeData.params || challengeData;
                for (const [key, val] of Object.entries(params)) {
                  if (key === "url" || key === "acsUrl") continue;
                  const input = document.createElement("input");
                  input.type = "hidden";
                  input.name = key;
                  input.value = String(val);
                  form.appendChild(input);
                }
                threeDsContainer.value.appendChild(form);
                form.submit();
              } else {
                // Fallback: use psdk-3ds component inside the container
                const el = document.createElement("psdk-3ds");
                el.setAttribute("data-challenge", JSON.stringify(challengeData));
                threeDsContainer.value.innerHTML = "";
                threeDsContainer.value.appendChild(el);
              }
            }
          });
          break;
        }
        case NextActionType.checkStatus:
          state.value = "status";
          startCompletionPolling();
          break;
        case NextActionType.showErrors: {
          const errors = (action as any)?.data?.errors ?? (action as any)?.extra?.errors ?? [];
          if (errors.length) {
            hasError = true;
            sdkReady.value = false;
            state.value = "error";
            errorMessage.value = errors.map((e: any) => e.message).join("\n");
          }
          break;
        }
        case NextActionType.showFields: {
          const fields = (action as any)?.data?.fields ?? [];
          state.value = "form";
          headlessCheckout.form.activate();
          if (fields.length) {
            // Cancel previous field loading if still pending
            if (fieldsAbortController) fieldsAbortController.abort();
            fieldsAbortController = new AbortController();
            headlessCheckout.form.setupAndAwaitFieldsLoading(fields, fieldsAbortController.signal).catch(() => {});
          }
          break;
        }
      }
    });

    if (!hasError) {
      sdkReady.value = true;
      state.value = "methods";

      // Wait for DOM then attach selectionChange listener
      await nextTick();
      setupMethodSelection();
      setupCouponListener();
    }
  } catch (e: any) {
    state.value = "error";
    errorMessage.value = e?.message || "Failed to initialize payment.";
  }
}

function setupMethodSelection() {
  const el = paymentMethodsEl.value;
  if (!el) return;

  el.addEventListener("selectionChange", async (e: any) => {
    const methodId = e?.detail?.paymentMethodId;
    if (!methodId) return;

    state.value = "loading";
    try {
      await headlessCheckout.form.init({
        paymentMethodId: methodId,
        returnUrl: window.location.origin,
        country: props.countryCode,
      });
      headlessCheckout.form.activate();
      if (!hasError) {
        state.value = "form";
      }
    } catch (err: any) {
      state.value = "error";
      errorMessage.value = err?.message || "Failed to initialize payment form.";
    }
  });
}

function startCompletionPolling() {
  if (props.mode === "one-time") {
    // One-time purchases (gifts, boost packs) — just emit completed
    emit("completed");
    return;
  }
  pollInterval = setInterval(async () => {
    await ultima.fetchSubscription();
    if (ultima.isSubscribed) {
      emit("completed");
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = null;
    }
  }, 3000);
}

function handleClose() {
  cleanup();
  open.value = false;
}

function handleDone() {
  ultima.fetchSubscription();
  emit("completed");
  cleanup();
  open.value = false;
}

function cleanup() {
  sdkReady.value = false;
  resetCouponState();
  if (fieldsAbortController) {
    fieldsAbortController.abort();
    fieldsAbortController = null;
  }
  if (unsubNextAction) {
    unsubNextAction();
    unsubNextAction = null;
  }
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  try {
    headlessCheckout.destroy();
  } catch { /* already destroyed */ }
}

watch(open, (isOpen) => {
  if (isOpen) {
    initCheckout();
  } else {
    cleanup();
  }
});

onUnmounted(() => {
  cleanup();
});
</script>

<style>
/* ==================== Animations ==================== */
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeSlideDown {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 15px rgba(124, 58, 237, 0.1); }
  50% { box-shadow: 0 0 25px rgba(124, 58, 237, 0.2); }
}

@keyframes spinnerPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* ==================== Dialog Container ==================== */
.checkout-dialog-content {
  background: linear-gradient(180deg, #18181b 0%, #0f0f11 100%) !important;
  border: 1px solid rgba(63, 63, 70, 0.4) !important;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.6), 0 0 40px rgba(124, 58, 237, 0.05) !important;
}

.checkout-header {
  border-bottom: 1px solid rgba(63, 63, 70, 0.2);
  background: linear-gradient(180deg, rgba(24, 24, 27, 0.8) 0%, transparent 100%);
}

.checkout-title {
  background: linear-gradient(135deg, #e4e4e7 0%, #a1a1aa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-weight: 600;
}

.checkout-footer {
  background: linear-gradient(0deg, rgba(24, 24, 27, 0.8) 0%, transparent 100%);
}

/* ==================== Loading State ==================== */
.checkout-loading {
  flex-direction: column;
  backdrop-filter: blur(4px);
}

.checkout-spinner {
  animation: pulseGlow 2s ease-in-out infinite;
  padding: 16px;
  border-radius: 50%;
  background: rgba(124, 58, 237, 0.05);
}

/* ==================== Error State ==================== */
.checkout-error-state {
  animation: scaleIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.checkout-error-icon {
  animation: pulseGlow 2s ease-in-out infinite;
  padding: 16px;
  border-radius: 50%;
  background: rgba(248, 113, 113, 0.05);
}

/* ==================== Methods View ==================== */
.checkout-methods-view {
  animation: fadeSlideUp 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 20px;
}

.checkout-methods-top {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.checkout-methods-bottom {
  margin-top: auto;
  padding-top: 16px;
}

/* Stagger payment method items */
.checkout-methods-view psdk-payment-methods .payment-method {
  animation: fadeSlideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1) both;
}

.checkout-methods-view psdk-payment-methods .payment-method:nth-child(1) { animation-delay: 0.03s; }
.checkout-methods-view psdk-payment-methods .payment-method:nth-child(2) { animation-delay: 0.06s; }
.checkout-methods-view psdk-payment-methods .payment-method:nth-child(3) { animation-delay: 0.09s; }
.checkout-methods-view psdk-payment-methods .payment-method:nth-child(4) { animation-delay: 0.12s; }
.checkout-methods-view psdk-payment-methods .payment-method:nth-child(5) { animation-delay: 0.15s; }
.checkout-methods-view psdk-payment-methods .payment-method:nth-child(6) { animation-delay: 0.18s; }
.checkout-methods-view psdk-payment-methods .payment-method:nth-child(7) { animation-delay: 0.21s; }
.checkout-methods-view psdk-payment-methods .payment-method:nth-child(8) { animation-delay: 0.24s; }
.checkout-methods-view psdk-payment-methods .payment-method:nth-child(9) { animation-delay: 0.27s; }
.checkout-methods-view psdk-payment-methods .payment-method:nth-child(10) { animation-delay: 0.3s; }

/* ==================== Form View ==================== */
.checkout-form-view {
  animation: fadeSlideUp 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ==================== 3DS / Redirect ==================== */
.checkout-3ds-container,
.checkout-redirect-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
  padding: 16px;
  display: flex;
  flex-direction: column;
}

.checkout-3ds-container > div,
.checkout-redirect-container > div {
  flex: 1;
  width: 100%;
  min-height: 100%;
}

.checkout-3ds-container iframe,
.checkout-redirect-container iframe {
  width: 100% !important;
  height: 100% !important;
  min-height: 380px;
  border: none !important;
}

.checkout-redirect-container psdk-redirect {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 380px;
}

.checkout-3ds-container psdk-3ds {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 380px;
}

/* ==================== Status View ==================== */
.checkout-status-view {
  animation: scaleIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ==================== Back Button ==================== */
.checkout-back-btn {
  transition: all 0.2s ease;
}

.checkout-back-btn:hover {
  transform: translateX(-2px);
}

/* Dark theme overrides for Xsolla Pay Station SDK */
.xsolla-checkout-container {
  --psdk-color-background: transparent;
  --psdk-color-text: #e4e4e7;
  --psdk-color-text-secondary: #a1a1aa;
  --psdk-color-border: #3f3f46;
  --psdk-color-input-background: #27272a;
  --psdk-color-input-border: #3f3f46;
  --psdk-color-button-background: #7c3aed;
  --psdk-color-button-text: #ffffff;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.xsolla-checkout-container *,
.xsolla-checkout-container *::before,
.xsolla-checkout-container *::after {
  font-family: inherit;
}

.xsolla-checkout-container input,
.xsolla-checkout-container button,
.xsolla-checkout-container select,
.xsolla-checkout-container textarea {
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

/* ==================== Scrollbar ==================== */
.xsolla-checkout-container::-webkit-scrollbar {
  width: 6px;
}

.xsolla-checkout-container::-webkit-scrollbar-track {
  background: transparent;
}

.xsolla-checkout-container::-webkit-scrollbar-thumb {
  background-color: #3f3f46;
  border-radius: 3px;
}

.xsolla-checkout-container::-webkit-scrollbar-thumb:hover {
  background-color: #52525b;
}

/* Global text color */
.xsolla-checkout-container,
.xsolla-checkout-container * {
  color: #e4e4e7;
}

/* ==================== Payment Methods List ==================== */
.xsolla-checkout-container psdk-payment-methods {
  display: block;
}

/* Search input - hidden */
.xsolla-checkout-container psdk-payment-methods .search-wrapper {
  display: none !important;
}

/* Methods list */
.xsolla-checkout-container psdk-payment-methods .payment-methods {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Individual method item */
.xsolla-checkout-container psdk-payment-methods .payment-method {
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  background-color: transparent !important;
  border: none !important;
}

.xsolla-checkout-container psdk-payment-methods .payment-method a {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  text-decoration: none;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(30, 30, 34, 0.9) 0%, rgba(39, 39, 42, 0.6) 100%) !important;
  border: 1px solid rgba(63, 63, 70, 0.4) !important;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.xsolla-checkout-container psdk-payment-methods .payment-method a::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.05) 0%, transparent 60%);
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
}

.xsolla-checkout-container psdk-payment-methods .payment-method a:hover {
  background: linear-gradient(135deg, rgba(39, 39, 42, 0.95) 0%, rgba(50, 50, 56, 0.8) 100%) !important;
  border-color: rgba(124, 58, 237, 0.3) !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 20px rgba(124, 58, 237, 0.06);
}

.xsolla-checkout-container psdk-payment-methods .payment-method a:hover::before {
  opacity: 1;
}

.xsolla-checkout-container psdk-payment-methods .payment-method a:active {
  transform: translateY(0) scale(0.99);
  transition-duration: 0.1s;
}

/* Method icon */
.xsolla-checkout-container psdk-payment-methods .payment-method .icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #27272a 0%, #1e1e22 100%);
  padding: 7px;
  border: 1px solid rgba(63, 63, 70, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  transition: all 0.2s ease;
}

.xsolla-checkout-container psdk-payment-methods .payment-method a:hover .icon {
  border-color: rgba(124, 58, 237, 0.25);
  background: linear-gradient(135deg, #2d2d32 0%, #222226 100%);
  box-shadow: 0 0 8px rgba(124, 58, 237, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.xsolla-checkout-container psdk-payment-methods .payment-method .icon img {
  width: 24px;
  height: 24px;
  object-fit: contain;
  transition: transform 0.2s ease;
}

.xsolla-checkout-container psdk-payment-methods .payment-method a:hover .icon img {
  transform: scale(1.05);
}

/* Method name */
.xsolla-checkout-container psdk-payment-methods .payment-method .name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: #e4e4e7 !important;
  letter-spacing: 0.01em;
  transition: color 0.15s ease;
}

.xsolla-checkout-container psdk-payment-methods .payment-method a:hover .name {
  color: #fafafa !important;
}

/* Arrow */
.xsolla-checkout-container psdk-payment-methods .payment-method .arrow {
  display: flex;
  align-items: center;
  opacity: 0;
  transform: translateX(-4px);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.xsolla-checkout-container psdk-payment-methods .payment-method .arrow img {
  width: 16px;
  height: 16px;
  filter: invert(1) brightness(0.8);
}

.xsolla-checkout-container psdk-payment-methods .payment-method a:hover .arrow {
  opacity: 0.7;
  transform: translateX(0);
}

/* ==================== Payment Form ==================== */
.xsolla-checkout-container psdk-payment-form {
  display: block;
}

.xsolla-checkout-container psdk-payment-form > div {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

/* Card number - full width */
.xsolla-checkout-container psdk-card-number {
  display: block;
  width: 100%;
}

/* Month/Year/CVV - equal width row */
.xsolla-checkout-container psdk-text[name="card_month"],
.xsolla-checkout-container psdk-text[name="card_year"],
.xsolla-checkout-container psdk-text[name="cvv"] {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  flex: 1 1 0;
  min-width: 0;
}

/* Hide the CVV description to keep row aligned cleanly */
.xsolla-checkout-container psdk-text[name="cvv"] .description {
  display: none;
}

/* Checkbox - full width */
.xsolla-checkout-container psdk-checkbox {
  display: block;
  width: 100%;
  margin-top: 4px;
}

/* Labels */
.xsolla-checkout-container psdk-card-number .label,
.xsolla-checkout-container psdk-text .label,
.xsolla-checkout-container psdk-payment-form .label {
  color: #a1a1aa !important;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* Description text (e.g. "Where to find your CVV/CVC") */
.xsolla-checkout-container psdk-text .description,
.xsolla-checkout-container psdk-card-number .description {
  color: #52525b !important;
  font-size: 11px;
  margin-bottom: 6px;
  font-style: italic;
}

/* Input wrappers */
.xsolla-checkout-container psdk-card-number .wrapper,
.xsolla-checkout-container psdk-text .wrapper {
  background: linear-gradient(135deg, rgba(24, 24, 27, 0.9) 0%, rgba(30, 30, 34, 0.7) 100%) !important;
  border: 1px solid rgba(63, 63, 70, 0.5) !important;
  border-radius: 12px !important;
  overflow: hidden;
  display: flex;
  align-items: center;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.02);
}

.xsolla-checkout-container psdk-card-number .wrapper:focus-within,
.xsolla-checkout-container psdk-text .wrapper:focus-within {
  border-color: rgba(124, 58, 237, 0.5) !important;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.08), 0 4px 12px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.03);
  background: linear-gradient(135deg, rgba(27, 27, 30, 0.95) 0%, rgba(33, 33, 37, 0.8) 100%) !important;
}

/* Additional controls wrapper (card number with icon) */
.xsolla-checkout-container .wrapper--additional-controls {
  display: flex;
  align-items: center;
}

/* Iframes inside wrappers */
.xsolla-checkout-container psdk-card-number iframe,
.xsolla-checkout-container psdk-text iframe {
  border: none !important;
  background: transparent !important;
  width: 100%;
  min-height: 44px;
}

/* Card icon */
.xsolla-checkout-container .card-icon {
  display: flex;
  align-items: center;
  padding-right: 14px;
  flex-shrink: 0;
}

.xsolla-checkout-container .card-icon .icon {
  opacity: 0.7;
  transition: opacity 0.2s ease;
}

.xsolla-checkout-container .wrapper:focus-within .card-icon .icon {
  opacity: 1;
}

/* ==================== Checkbox ==================== */
.xsolla-checkout-container psdk-checkbox .checkbox {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;
  padding: 12px 14px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(24, 24, 27, 0.6) 0%, rgba(30, 30, 34, 0.4) 100%);
  border: 1px solid rgba(63, 63, 70, 0.3);
  transition: all 0.2s ease;
}

.xsolla-checkout-container psdk-checkbox .checkbox:hover {
  border-color: rgba(63, 63, 70, 0.6);
  background: linear-gradient(135deg, rgba(27, 27, 30, 0.8) 0%, rgba(33, 33, 37, 0.5) 100%);
}

.xsolla-checkout-container psdk-checkbox input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  min-width: 20px;
  border: 2px solid rgba(82, 82, 91, 0.8) !important;
  border-radius: 6px !important;
  background-color: rgba(39, 39, 42, 0.8) !important;
  cursor: pointer;
  position: relative;
  margin-top: 1px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.xsolla-checkout-container psdk-checkbox input[type="checkbox"]:hover {
  border-color: rgba(124, 58, 237, 0.5) !important;
}

.xsolla-checkout-container psdk-checkbox input[type="checkbox"]:checked {
  background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%) !important;
  border-color: #7c3aed !important;
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.3);
}

.xsolla-checkout-container psdk-checkbox input[type="checkbox"]:checked::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 6px;
  width: 5px;
  height: 9px;
  border: solid #ffffff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.xsolla-checkout-container psdk-checkbox .checkbox-dummy {
  display: none;
}

.xsolla-checkout-container psdk-checkbox .wrapper {
  background: none !important;
  border: none !important;
  padding: 0 !important;
}

.xsolla-checkout-container psdk-checkbox .wrapper .label {
  color: #a1a1aa !important;
  font-size: 12px;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
  line-height: 1.5;
}

/* Field errors */
.xsolla-checkout-container .field-error {
  color: #f87171 !important;
  font-size: 12px;
  margin-top: 6px;
}

/* ==================== Generic form inputs (non-iframe) ==================== */
.xsolla-checkout-container input:not([type="checkbox"]),
.xsolla-checkout-container select,
.xsolla-checkout-container textarea {
  background: linear-gradient(135deg, rgba(24, 24, 27, 0.9) 0%, rgba(30, 30, 34, 0.7) 100%) !important;
  color: #e4e4e7 !important;
  border: 1px solid rgba(63, 63, 70, 0.5) !important;
  border-radius: 12px !important;
  padding: 10px 14px;
  font-size: 14px;
  transition: all 0.2s ease;
}

.xsolla-checkout-container input:not([type="checkbox"]):focus,
.xsolla-checkout-container select:focus,
.xsolla-checkout-container textarea:focus {
  border-color: rgba(124, 58, 237, 0.5) !important;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.08);
  outline: none;
}

/* ==================== Legal ==================== */
.xsolla-checkout-container psdk-legal {
  display: block;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(63, 63, 70, 0.3);
}

.xsolla-checkout-container psdk-legal .disclaimer {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  margin-bottom: 12px;
}

.xsolla-checkout-container psdk-legal .disclaimer .terms,
.xsolla-checkout-container psdk-legal .disclaimer .cookies,
.xsolla-checkout-container psdk-legal .disclaimer .mor,
.xsolla-checkout-container psdk-legal .disclaimer .support {
  color: #52525b !important;
  font-size: 11px;
  line-height: 1.5;
}

.xsolla-checkout-container psdk-legal .disclaimer a {
  color: #8b5cf6 !important;
  text-decoration: none;
  transition: color 0.15s ease;
}

.xsolla-checkout-container psdk-legal .disclaimer a:hover {
  color: #a78bfa !important;
  text-decoration: underline;
}

.xsolla-checkout-container psdk-legal .additional-info {
  padding-top: 8px;
}

.xsolla-checkout-container psdk-legal .legal-links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  flex-wrap: wrap;
}

.xsolla-checkout-container psdk-legal .legal-links .link {
  color: #52525b !important;
  font-size: 11px;
  text-decoration: none;
  padding: 4px 0;
  transition: color 0.15s ease;
}

.xsolla-checkout-container psdk-legal .legal-links .link:hover {
  color: #8b5cf6 !important;
}

.xsolla-checkout-container psdk-legal .legal-links .divider {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background-color: #3f3f46;
  margin: 0 10px;
}

/* Fallback for non-structured legal */
.xsolla-checkout-container psdk-legal *:not(.disclaimer):not(.additional-info):not(.legal-links):not(.link):not(.divider):not(.terms):not(.cookies):not(.mor):not(.support):not(a) {
  color: #52525b !important;
  font-size: 11px;
}

/* ==================== Finance Details & Total ==================== */
.xsolla-checkout-container psdk-finance-details {
  display: block;
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(24, 24, 27, 0.5) 0%, rgba(30, 30, 34, 0.3) 100%);
  border: 1px solid rgba(63, 63, 70, 0.2);
}

.xsolla-checkout-container psdk-finance-details:empty {
  display: none;
}

.xsolla-checkout-container psdk-finance-details *,
.xsolla-checkout-container [class*="finance"] {
  color: #a1a1aa !important;
  font-size: 13px;
}

.xsolla-checkout-container psdk-total {
  display: block;
}

.xsolla-checkout-container psdk-total *,
.xsolla-checkout-container [class*="total"] {
  color: #e4e4e7 !important;
  font-size: 16px;
  font-weight: 600;
}

/* ==================== Submit Button ==================== */
.xsolla-checkout-container psdk-submit-button,
.xsolla-checkout-container psdk-default-submit-button {
  display: block;
  width: 100%;
}

.xsolla-checkout-container psdk-submit-button button,
.xsolla-checkout-container [class*="submit-button"] button {
  min-width: 100%;
  background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%) !important;
  color: #ffffff !important;
  border: none !important;
  border-radius: 10px !important;
  padding: 12px 28px !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 12px rgba(124, 58, 237, 0.25), 0 2px 4px rgba(0, 0, 0, 0.1);
  position: relative;
  overflow: hidden;
}

.xsolla-checkout-container psdk-submit-button button::before,
.xsolla-checkout-container [class*="submit-button"] button::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, transparent 50%);
  pointer-events: none;
}

.xsolla-checkout-container psdk-submit-button button:hover,
.xsolla-checkout-container [class*="submit-button"] button:hover {
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%) !important;
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(124, 58, 237, 0.35), 0 2px 8px rgba(0, 0, 0, 0.2);
}

.xsolla-checkout-container psdk-submit-button button:active,
.xsolla-checkout-container [class*="submit-button"] button:active {
  transform: translateY(0) scale(0.98);
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.2);
}

.xsolla-checkout-container psdk-submit-button button:disabled {
  background: linear-gradient(135deg, #3f3f46 0%, #27272a 100%) !important;
  color: #71717a !important;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

/* ==================== Status ==================== */
.xsolla-checkout-container psdk-status,
.xsolla-checkout-container psdk-status *,
.xsolla-checkout-container [class*="status"] {
  color: #e4e4e7 !important;
}

/* ==================== Form Messages ==================== */
.xsolla-checkout-container psdk-payment-form-messages {
  display: block;
  margin-top: 12px;
}

.xsolla-checkout-container psdk-payment-form-messages .payment-form-messages {
  padding: 10px 14px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.06) 0%, rgba(251, 191, 36, 0.02) 100%);
  border: 1px solid rgba(251, 191, 36, 0.15);
}

.xsolla-checkout-container psdk-payment-form-messages .payment-form-messages:empty {
  display: none;
}

.xsolla-checkout-container psdk-payment-form-messages .form-message {
  color: #fbbf24 !important;
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
}

.xsolla-checkout-container psdk-payment-form-messages .form-message a {
  color: #a78bfa !important;
  text-decoration: underline;
}

/* ==================== Select component ==================== */
.xsolla-checkout-container psdk-select {
  display: block;
}

.xsolla-checkout-container psdk-select select {
  width: 100%;
}

/* ==================== Form Card Wrappers ==================== */
.xsolla-checkout-container .checkout-form-card {
  padding: 24px;
  border-radius: 16px;
  background: linear-gradient(145deg, rgba(30, 30, 34, 0.8) 0%, rgba(24, 24, 27, 0.6) 100%);
  border: 1px solid rgba(63, 63, 70, 0.3);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.03);
  position: relative;
  overflow: hidden;
  animation: fadeSlideUp 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.xsolla-checkout-container .checkout-form-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(124, 58, 237, 0.3) 50%, transparent 100%);
}

.xsolla-checkout-container .checkout-form-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(63, 63, 70, 0.2);
}

.xsolla-checkout-container .checkout-form-card-icon {
  font-size: 20px;
  line-height: 1;
}

.xsolla-checkout-container .checkout-form-card-title {
  font-size: 14px;
  font-weight: 600;
  color: #e4e4e7;
  letter-spacing: 0.01em;
}

.xsolla-checkout-container .checkout-summary-card {
  padding: 18px 20px;
  border-radius: 14px;
  background: linear-gradient(145deg, rgba(30, 30, 34, 0.6) 0%, rgba(24, 24, 27, 0.4) 100%);
  border: 1px solid rgba(63, 63, 70, 0.2);
  animation: fadeSlideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.1s both;
  position: relative;
  overflow: hidden;
}

.xsolla-checkout-container .checkout-summary-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(124, 58, 237, 0.2) 50%, transparent 100%);
}

.xsolla-checkout-container .checkout-summary-card psdk-finance-details {
  margin-top: 0;
  padding: 0;
  background: none !important;
  border: none !important;
  margin-bottom: 14px;
}

.xsolla-checkout-container .checkout-pay-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(63, 63, 70, 0.2);
}

.xsolla-checkout-container .checkout-total-row {
  padding-top: 14px;
  border-top: 1px solid rgba(63, 63, 70, 0.2);
}

.xsolla-checkout-container .checkout-submit-row {
  padding-top: 14px;
}

/* ==================== Coupon ==================== */
.xsolla-checkout-container .coupon-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.xsolla-checkout-container .coupon-input {
  width: 140px;
  background: linear-gradient(135deg, rgba(24, 24, 27, 0.9) 0%, rgba(30, 30, 34, 0.7) 100%) !important;
  color: #e4e4e7 !important;
  border: 1px solid rgba(63, 63, 70, 0.5) !important;
  border-radius: 8px !important;
  padding: 7px 12px;
  font-size: 12px;
  transition: all 0.2s ease;
}

.xsolla-checkout-container .coupon-input:focus {
  border-color: rgba(124, 58, 237, 0.5) !important;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.08);
  outline: none;
}

.xsolla-checkout-container .coupon-input::placeholder {
  color: #52525b;
}

.xsolla-checkout-container .coupon-input:disabled {
  opacity: 0.6;
}

.xsolla-checkout-container .coupon-apply-btn,
.xsolla-checkout-container .coupon-remove-btn {
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid rgba(63, 63, 70, 0.5);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
}

.xsolla-checkout-container .coupon-apply-btn {
  background: linear-gradient(135deg, rgba(63, 63, 70, 0.6) 0%, rgba(39, 39, 42, 0.8) 100%);
  color: #e4e4e7;
}

.xsolla-checkout-container .coupon-apply-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.3) 0%, rgba(109, 40, 217, 0.2) 100%);
  border-color: rgba(124, 58, 237, 0.4);
}

.xsolla-checkout-container .coupon-apply-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.xsolla-checkout-container .coupon-remove-btn {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(220, 38, 38, 0.1) 100%);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}

.xsolla-checkout-container .coupon-remove-btn:hover {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(220, 38, 38, 0.15) 100%);
  border-color: rgba(239, 68, 68, 0.5);
}

.xsolla-checkout-container .coupon-msg {
  margin: 6px 0 12px;
  font-size: 11px;
  padding-left: 30px;
}

.xsolla-checkout-container .coupon-error {
  color: #f87171;
}

.xsolla-checkout-container .coupon-success {
  color: #4ade80;
  font-weight: 500;
}

/* ==================== Submit button shimmer ==================== */
.xsolla-checkout-container psdk-submit-button button::after,
.xsolla-checkout-container [class*="submit-button"] button::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.08) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: shimmer 3s ease-in-out infinite;
  pointer-events: none;
  border-radius: inherit;
}
</style>
