import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useApi } from "@/store/system/apiStore";
import { logger } from "@argon/core";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";

export const useCallManager = defineStore("callManager", () => {
  const api = useApi();
  const router = useRouter();
  const call = useUnifiedCall();

  const activeCallId = ref<string | null>(null);
  const activePeerId = ref<string | null>(null);

  const incomingCall = computed(() => call.incoming);
  const hasIncoming = computed(() => call.incoming !== null);

  watch(
    () => call.callId,
    (newVal, oldVal) => {
      activeCallId.value = newVal;

      if (!newVal && oldVal) {
        activePeerId.value = null;
        removeCallQuery();
      }
    },
    { immediate: true }
  );

  async function startOutgoingCall(peerUserId: string) {
    logger.info("[DM] startOutgoingCall ->", peerUserId);

    await router.push({
      name: "HomeChat",
      params: { userId: peerUserId },
    });

    await call.startDirectCall(peerUserId);

    activePeerId.value = peerUserId;

    if (call.callId) {
      await setCallQuery(call.callId);
    }
  }

  async function acceptIncomingCall() {
    const incoming = call.incoming;
    if (!incoming) {
      logger.warn("[DM] acceptIncomingCall: no incoming");
      return;
    }

    const peerId = incoming.fromId;

    // сразу открываем чат
    await router.push({
      name: "HomeChat",
      params: { userId: peerId },
    });

    await call.acceptIncomingCall();

    activePeerId.value = peerId;

    if (call.callId) {
      await setCallQuery(call.callId);
    }
  }

  async function rejectIncomingCall() {
    await call.rejectIncomingCall();
  }

  async function hangupCall() {
    const cid = call.callId;
    if (!cid) return;

    try {
      await api.callInteraction.HangupCall(cid);
    } catch (e) {
      logger.error("[DM] HangupCall failed", e);
    }
    activeCallId.value = null;
    activePeerId.value = null;
    await call.leave();
    removeCallQuery();
  }

  async function setCallQuery(callId: string) {
    const current = router.currentRoute.value;
    const query = { ...current.query, call: callId };
    await router.replace({ ...current, query });
  }

  async function removeCallQuery() {
    const current = router.currentRoute.value;
    if (!current.query.call) return;

    const query = { ...current.query };
    delete query.call;
    await router.replace({ ...current, query });
  }


  (window as any).callManager = {
    startOutgoingCall,
    acceptIncomingCall,
    rejectIncomingCall,
    hangupCall,
  };

  return {
    activeCallId,
    activePeerId,
    incomingCall,
    hasIncoming,

    startOutgoingCall,
    acceptIncomingCall,
    rejectIncomingCall,
    hangupCall,
  };
});
