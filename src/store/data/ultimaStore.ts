import { logger } from "@argon/core";
import { defineStore } from "pinia";
import { metrics, enumName, errorKind } from "@/lib/telemetry/metrics";
import { computed, ref } from "vue";
import { useApi } from "@/store/system/apiStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import {
  type UltimaPricing,
  type UltimaSubscriptionInfo,
  type UltimaBoost,
  type SpaceBoostStatus,
  type UltimaTransaction,
  UltimaPlan,
  UltimaSubscriptionStatus,
  BoostPackType,
  CheckoutError,
  ApplyBoostError,
  TransferBoostError,
  PurchaseBoostError,
  SendGiftError,
} from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

export const useUltimaStore = defineStore("ultima", () => {
  const api = useApi();

  const subscription = ref<UltimaSubscriptionInfo | null>(null);
  const boosts = ref<UltimaBoost[]>([]);
  const transactions = ref<UltimaTransaction[]>([]);
  const pricing = ref<UltimaPricing | null>(null);
  const loading = ref(false);

  // Seamless account switch: clear subscription/boost state; init() repopulates for the new account.
  onSessionReset(() => {
    subscription.value = null;
    boosts.value = [];
    transactions.value = [];
    pricing.value = null;
    loading.value = false;
  });

  const isSubscribed = computed(() =>
    subscription.value !== null &&
    (subscription.value.status === UltimaSubscriptionStatus.Active ||
      subscription.value.status === UltimaSubscriptionStatus.GracePeriod)
  );

  const availableBoostSlots = computed(() => {
    if (!subscription.value) return 0;
    return subscription.value.totalBoostSlots - subscription.value.usedBoostSlots;
  });

  const unassignedBoosts = computed(() =>
    boosts.value.filter((b) => b.spaceId === null)
  );

  async function fetchSubscription() {
    try {
      subscription.value = await api.ultimaInteraction.GetMySubscription();
      logger.info("Received subscription info ", subscription.value);
    } catch (e) {
      logger.error("Failed to fetch subscription", e);
    }
  }

  async function fetchPricing() {
    try {
      pricing.value = await api.ultimaInteraction.GetPricing();
      logger.info("Received pricing info ", pricing.value);
    } catch (e) {
      logger.error("Failed to fetch pricing", e);
    }
  }

  async function fetchBoosts() {
    try {
      const result = await api.ultimaInteraction.GetMyBoosts();
      boosts.value = [...result];
    } catch (e) {
      logger.error("Failed to fetch boosts", e);
    }
  }

  async function fetchTransactions() {
    try {
      const result = await api.ultimaInteraction.GetTransactionHistory();
      transactions.value = [...result];
      logger.info("Received transactions ", transactions.value);
    } catch (e) {
      logger.error("Failed to fetch transactions", e);
    }
  }

  async function createCheckout(plan: UltimaPlan) {
    const result = await api.ultimaInteraction.CreateCheckoutSession(plan);
    metrics.count("ultima.checkout", {
      plan: enumName(UltimaPlan, plan),
      result: result.isSuccessCheckout() ? "ok" : "failed",
      error: result.isFailedCheckout() ? enumName(CheckoutError, result.error) : undefined,
    });
    if (result.isSuccessCheckout()) {
      return { success: true as const, checkoutUrl: result.checkoutUrl, sessionId: result.sessionId, countryCode: result.countryCode };
    } else if (result.isFailedCheckout()) {
      return { success: false as const, error: result.error };
    }
    return { success: false as const, error: CheckoutError.PAYMENT_ERROR };
  }

  async function cancelSubscription() {
    try {
      const result = await api.ultimaInteraction.CancelSubscription();
      metrics.count("ultima.subscription.cancel", { result: result ? "ok" : "failed" });
      if (result) {
        await fetchSubscription();
      }
      return result;
    } catch (e) {
      logger.error("Failed to cancel subscription", e);
      metrics.count("ultima.subscription.cancel", { result: "failed", error: errorKind(e) });
      return false;
    }
  }

  async function applyBoost(boostId: Guid, spaceId: Guid) {
    const result = await api.ultimaInteraction.ApplyBoost(boostId, spaceId);
    if (result.isSuccessApplyBoost()) {
      metrics.count("ultima.boost", { action: "apply", result: "ok" });
      await fetchBoosts();
      return { success: true as const };
    }
    const failed = result as any;
    metrics.count("ultima.boost", { action: "apply", result: "failed", error: enumName(ApplyBoostError, failed.error) });
    return { success: false as const, error: failed.error as ApplyBoostError };
  }

  async function transferBoost(boostId: Guid, newSpaceId: Guid) {
    const result = await api.ultimaInteraction.TransferBoost(boostId, newSpaceId);
    if (result.isSuccessTransfer()) {
      metrics.count("ultima.boost", { action: "transfer", result: "ok" });
      await fetchBoosts();
      return { success: true as const };
    }
    const failed = result as any;
    metrics.count("ultima.boost", { action: "transfer", result: "failed", error: enumName(TransferBoostError, failed.error) });
    return { success: false as const, error: failed.error as TransferBoostError };
  }

  async function removeBoost(boostId: Guid) {
    try {
      const result = await api.ultimaInteraction.RemoveBoost(boostId);
      metrics.count("ultima.boost", { action: "remove", result: result ? "ok" : "failed" });
      if (result) {
        await fetchBoosts();
      }
      return result;
    } catch (e) {
      logger.error("Failed to remove boost", e);
      metrics.count("ultima.boost", { action: "remove", result: "failed", error: errorKind(e) });
      return false;
    }
  }

  async function fetchSpaceBoostStatus(spaceId: Guid): Promise<SpaceBoostStatus | null> {
    try {
      return await api.ultimaInteraction.GetSpaceBoostStatus(spaceId);
    } catch (e) {
      logger.error("Failed to fetch space boost status", e);
      return null;
    }
  }

  async function purchaseBoostPack(pack: BoostPackType) {
    const result = await api.ultimaInteraction.PurchaseBoostPack(pack);
    metrics.count("ultima.boost_pack.purchase", {
      pack: enumName(BoostPackType, pack),
      result: result.isSuccessPurchaseBoost() ? "ok" : "failed",
      error: result.isFailedPurchaseBoost() ? enumName(PurchaseBoostError, result.error) : undefined,
    });
    if (result.isSuccessPurchaseBoost()) {
      return { success: true as const, checkoutUrl: result.checkoutUrl, countryCode: result.countryCode };
    } else if (result.isFailedPurchaseBoost()) {
      return { success: false as const, error: result.error };
    }
    return { success: false as const, error: PurchaseBoostError.PAYMENT_ERROR };
  }

  async function sendGift(recipientId: Guid, plan: UltimaPlan, message: string | null = null) {
    const result = await api.ultimaInteraction.SendUltimaGift(recipientId, plan, message);
    metrics.count("ultima.gift", {
      plan: enumName(UltimaPlan, plan),
      with_message: !!message,
      result: result.isSuccessSendGift() ? "ok" : "failed",
      error: result.isFailedSendGift() ? enumName(SendGiftError, result.error) : undefined,
    });
    if (result.isSuccessSendGift()) {
      return { success: true as const, checkoutUrl: result.checkoutUrl, countryCode: result.countryCode };
    } else if (result.isFailedSendGift()) {
      return { success: false as const, error: result.error };
    }
    return { success: false as const, error: SendGiftError.PAYMENT_ERROR };
  }

  async function init() {
    loading.value = true;
    try {
      await Promise.all([fetchSubscription(), fetchPricing(), fetchBoosts()]);
      // Once per session: what share of active users hold a subscription, and in which state.
      metrics.count("ultima.subscription.state", {
        status: subscription.value ? enumName(UltimaSubscriptionStatus, subscription.value.status) : "none",
        boosts: boosts.value.length,
      });
    } finally {
      loading.value = false;
    }
  }

  return {
    subscription,
    boosts,
    transactions,
    pricing,
    loading,
    isSubscribed,
    availableBoostSlots,
    unassignedBoosts,
    fetchSubscription,
    fetchPricing,
    fetchBoosts,
    fetchTransactions,
    createCheckout,
    cancelSubscription,
    applyBoost,
    transferBoost,
    removeBoost,
    fetchSpaceBoostStatus,
    purchaseBoostPack,
    sendGift,
    init,
  };
});
