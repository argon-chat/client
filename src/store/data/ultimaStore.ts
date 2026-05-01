import { logger } from "@argon/core";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useApi } from "@/store/system/apiStore";
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
      if (result) {
        await fetchSubscription();
      }
      return result;
    } catch (e) {
      logger.error("Failed to cancel subscription", e);
      return false;
    }
  }

  async function applyBoost(boostId: Guid, spaceId: Guid) {
    const result = await api.ultimaInteraction.ApplyBoost(boostId, spaceId);
    if (result.isSuccessApplyBoost()) {
      await fetchBoosts();
      return { success: true as const };
    }
    const failed = result as any;
    return { success: false as const, error: failed.error as ApplyBoostError };
  }

  async function transferBoost(boostId: Guid, newSpaceId: Guid) {
    const result = await api.ultimaInteraction.TransferBoost(boostId, newSpaceId);
    if (result.isSuccessTransfer()) {
      await fetchBoosts();
      return { success: true as const };
    }
    const failed = result as any;
    return { success: false as const, error: failed.error as TransferBoostError };
  }

  async function removeBoost(boostId: Guid) {
    try {
      const result = await api.ultimaInteraction.RemoveBoost(boostId);
      if (result) {
        await fetchBoosts();
      }
      return result;
    } catch (e) {
      logger.error("Failed to remove boost", e);
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
    if (result.isSuccessPurchaseBoost()) {
      return { success: true as const, checkoutUrl: result.checkoutUrl, countryCode: result.countryCode };
    } else if (result.isFailedPurchaseBoost()) {
      return { success: false as const, error: result.error };
    }
    return { success: false as const, error: PurchaseBoostError.PAYMENT_ERROR };
  }

  async function sendGift(recipientId: Guid, plan: UltimaPlan, message: string | null = null) {
    const result = await api.ultimaInteraction.SendUltimaGift(recipientId, plan, message);
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
