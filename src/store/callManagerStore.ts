// src/store/callManagerStore.ts
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useApi } from "./apiStore";
import { logger } from "@argon/core";
import { useUnifiedCall } from "@/store/unifiedCallStore";

export const useCallManager = defineStore("callManager", () => {
  const api = useApi();
  const router = useRouter();
  const call = useUnifiedCall();

  // для совместимости/удобства — локальные ссылки на активный звонок
  const activeCallId = ref<string | null>(null);
  const activePeerId = ref<string | null>(null);

  // входящий звонок просто проксируем из unifiedCall
  const incomingCall = computed(() => call.incoming);
  const hasIncoming = computed(() => call.incoming !== null);

  // синхронизируем состояние с unifiedCall.callId
  watch(
    () => call.callId,
    (newVal, oldVal) => {
      activeCallId.value = newVal;

      // если звонок завершился (callId стал null) — чистим peer и урл
      if (!newVal && oldVal) {
        activePeerId.value = null;
        removeCallQuery();
      }
    },
    { immediate: true }
  );

  // =============================
  // START OUTGOING DM CALL
  // =============================
  async function startOutgoingCall(peerUserId: string) {
    logger.info("[DM] startOutgoingCall ->", peerUserId);

    // сначала открываем чат с этим юзером
    await router.push({
      name: "HomeChat",
      params: { userId: peerUserId },
      // query: { call: ??? } — пока не знаем callId, он придёт из unifiedCall
    });

    // unifiedCall сам сделает DingDongCreep + joinLiveKit
    await call.startDirectCall(peerUserId);

    // после этого в unifiedCall.callId появится значение — watcher выше его подхватит
    activePeerId.value = peerUserId;

    // добавим ?call= в урл, если callId уже известен
    if (call.callId) {
      await setCallQuery(call.callId);
    }
  }

  // =============================
  // ACCEPT INCOMING
  // =============================
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

    // unifiedCall сам дернёт PickUpCall + joinLiveKit
    await call.acceptIncomingCall();

    activePeerId.value = peerId;

    if (call.callId) {
      await setCallQuery(call.callId);
    }
  }

  // =============================
  // REJECT INCOMING CALL
  // =============================
  async function rejectIncomingCall() {
    await call.rejectIncomingCall();
  }

  // =============================
  // HANGUP CALL (мы инициатор завершения)
  // =============================
  async function hangupCall() {
    const cid = call.callId;
    if (!cid) return;

    try {
      await api.callInteraction.HangupCall(cid);
    } catch (e) {
      logger.error("[DM] HangupCall failed", e);
    }

    // unifiedCall через CallFinished (bus) сам сделает leave(),
    // но на всякий случай можно жёстко очистить локальное состояние
    activeCallId.value = null;
    activePeerId.value = null;
    await call.leave();
    removeCallQuery();
  }

  // =============================
  // helpers для работы с ?call= в урле
  // =============================
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
