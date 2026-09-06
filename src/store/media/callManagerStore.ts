import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useApi } from "@/store/system/apiStore";
import { logger } from "@argon/core";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";

export const useCallManager = defineStore("callManager", () => {
  const api = useApi();
  const router = useRouter();
  const call = useUnifiedCall();

  const activeCallId = ref<string | null>(null);
  const activePeerId = ref<string | null>(null);
  /**
   * Who is being dialled right now, from the moment a call is asked for until the server has
   * answered. Held here, not in the chat view: a call can start from the chat header, the DM list's
   * menu or the "active now" widget, and the view has to show "calling…" the instant it opens
   * whichever of them asked.
   */
  const dialingPeerId = ref<string | null>(null);

  // Seamless account switch: clear active-call tracking (the call itself is left by the orchestrator).
  onSessionReset(() => {
    activeCallId.value = null;
    activePeerId.value = null;
    dialingPeerId.value = null;
  });

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
    if (dialingPeerId.value) return;

    // Marked before the navigation so the chat view mounts already showing "calling…", and
    // the peer is known before the server answers so the view keeps it through the handshake.
    dialingPeerId.value = peerUserId;
    activePeerId.value = peerUserId;
    dialCancelled = false;

    try {
      await router.push({
        name: "HomeChat",
        params: { userId: peerUserId },
      });

      await call.startDirectCall(peerUserId);

      if (dialCancelled) {
        // Cancelled while the request was in flight: the call exists now, so end it properly.
        dialCancelled = false;
        dialingPeerId.value = null;
        if (call.callId) await hangupCall();
        return;
      }

      if (call.callId) {
        await setCallQuery(call.callId);
      } else {
        // Refused or failed before a call existed: nothing to keep pointing at.
        activePeerId.value = null;
      }
    } catch (e) {
      activePeerId.value = null;
      throw e;
    } finally {
      dialingPeerId.value = null;
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

  /** Set when "cancel" was pressed while the dial request was still in flight. */
  let dialCancelled = false;

  async function hangupCall() {
    const cid = call.callId;
    if (!cid) {
      // Nothing to hang up yet, but the overlay is showing: drop it now and let the pending dial
      // hang up on itself the moment the server answers (see startOutgoingCall).
      if (dialingPeerId.value) {
        dialCancelled = true;
        dialingPeerId.value = null;
        activePeerId.value = null;
      }
      return;
    }

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
    dialingPeerId,
    incomingCall,
    hasIncoming,

    startOutgoingCall,
    acceptIncomingCall,
    rejectIncomingCall,
    hangupCall,
  };
});
