import { Guid } from "@argon-chat/ion.webcore";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useApi } from "./apiStore";
import { useTone } from "./toneStore";
import { IPickUpCallResult, SuccessPickUp } from "@/lib/glue/argonChat";
import { usePoolStore } from "./poolStore";
export interface CallIncoming {
  callId: string;
  fromUserId: string;
  fromUserUsername: string;
}

export const useCallStore = defineStore("call", () => {
  const api = useApi();
  const tone = useTone();
  const incomingCallInfo = ref(null as CallIncoming | null);
  const activeCallToken = ref<string | null>(null);
  const activePeerUserId = ref<Guid | null>(null);
  const lastPickUpResult = ref<IPickUpCallResult | null>(null);

  const incomingCall = async function (callId: Guid, fromUserId: Guid) {
    incomingCallInfo.value = {
      callId,
      fromUserId,
      fromUserUsername: (await usePoolStore().getUser(fromUserId))?.username ?? "unknown"
    };
    tone.playRingSound();
  };

  const incomingCallClosed = function (callId: Guid) {
    if (incomingCallInfo.value) {
      tone.stopPlayRingSound();
      incomingCallInfo.value = null;
      activePeerUserId.value = null;
      activeCallToken.value = null;
    }
  };

  const pickUp = async () => {
    if (!incomingCallInfo.value) return null;

    const result = await api.callInteraction.PickUpCall(incomingCallInfo.value.callId);
    lastPickUpResult.value = result;

    if (result.isSuccessPickUp()) {

      activeCallToken.value = result.token;

      activePeerUserId.value = incomingCallInfo.value.fromUserId;

      incomingCallInfo.value = null;

      //goToDMPage(success.callId);

      //startLiveKitConnection(success.token);

      return result;
    }

    // На fail окно не закрываем
    return result;
  };
  return {
    incomingCallClosed,
    incomingCall,
    incomingCallInfo
  };
});
