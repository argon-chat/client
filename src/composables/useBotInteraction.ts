import { ref, reactive } from "vue";
import { defineStore } from "pinia";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";
import { logger } from "@argon/core";
import type {
  IonModalDefinition,
  ModalSubmitValue,
  ShowModal,
  InteractionAcked,
  InteractionDeferred,
} from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import type { Subscription } from "rxjs";

export type InteractionState = "pending" | "acked" | "deferred" | "failed";

export const useBotInteraction = defineStore("botInteraction", () => {
  const api = useApi();
  const bus = useBus();

  const activeModal = ref<{
    interactionId: string;
    modal: IonModalDefinition;
    spaceId: string;
    channelId: string;
  } | null>(null);

  const pendingInteractions = reactive(new Map<string, InteractionState>());

  const subs: Subscription[] = [];

  function subscribe() {
    subs.push(
      bus.onServerEvent<ShowModal>("ShowModal", (ev) => {
        const pending = pendingInteractions.get(ev.interactionId);
        if (pending) {
          pendingInteractions.delete(ev.interactionId);
        }
        activeModal.value = {
          interactionId: ev.interactionId,
          modal: ev.modal,
          spaceId: "",
          channelId: "",
        };
      }),
    );

    subs.push(
      bus.onServerEvent<InteractionAcked>("InteractionAcked", (ev) => {
        pendingInteractions.set(ev.interactionId, "acked");
        setTimeout(() => pendingInteractions.delete(ev.interactionId), 3000);
      }),
    );

    subs.push(
      bus.onServerEvent<InteractionDeferred>("InteractionDeferred", (ev) => {
        pendingInteractions.set(ev.interactionId, "deferred");
      }),
    );
  }

  function unsubscribe() {
    for (const s of subs) s.unsubscribe();
    subs.length = 0;
  }

  async function interactWithControl(
    spaceId: Guid,
    channelId: Guid,
    messageId: bigint,
    controlId: string,
  ): Promise<string | null> {
    try {
      const result = await api.channelInteraction.InteractWithControl(
        spaceId,
        channelId,
        messageId,
        controlId,
      );
      if (result.isSuccessInteractWithControl()) {
        const interactionId = result.interactionId;
        pendingInteractions.set(interactionId, "pending");
        // Timeout after 15s
        setTimeout(() => {
          if (pendingInteractions.get(interactionId) === "pending") {
            pendingInteractions.set(interactionId, "failed");
            setTimeout(() => pendingInteractions.delete(interactionId), 3000);
          }
        }, 15000);
        return interactionId;
      }
      if (result.isFailedInteractWithControl()) {
        logger.error("InteractWithControl failed:", result.error);
      }
      return null;
    } catch (error) {
      logger.error("InteractWithControl error:", error);
      return null;
    }
  }

  async function interactWithSelect(
    spaceId: Guid,
    channelId: Guid,
    messageId: bigint,
    customId: string,
    values: string[],
  ): Promise<string | null> {
    try {
      const result = await api.channelInteraction.InteractWithSelect(
        spaceId,
        channelId,
        messageId,
        customId,
        values as any,
      );
      if (result.isSuccessInteractWithSelect()) {
        const interactionId = result.interactionId;
        pendingInteractions.set(interactionId, "pending");
        setTimeout(() => {
          if (pendingInteractions.get(interactionId) === "pending") {
            pendingInteractions.set(interactionId, "failed");
            setTimeout(() => pendingInteractions.delete(interactionId), 3000);
          }
        }, 15000);
        return interactionId;
      }
      if (result.isFailedInteractWithSelect()) {
        logger.error("InteractWithSelect failed:", result.error);
      }
      return null;
    } catch (error) {
      logger.error("InteractWithSelect error:", error);
      return null;
    }
  }

  async function submitModal(
    spaceId: Guid,
    channelId: Guid,
    interactionId: string,
    values: ModalSubmitValue[],
  ): Promise<boolean> {
    try {
      const result = await api.channelInteraction.SubmitModal(
        spaceId,
        channelId,
        interactionId,
        values as any,
      );
      if (result.isFailedSubmitModal()) {
        logger.error("SubmitModal failed:", result.error);
      }
      if (result.isSuccessSubmitModal()) {
        activeModal.value = null;
        return true;
      }
      return false;
    } catch (error) {
      logger.error("SubmitModal error:", error);
      return false;
    }
  }

  async function invokeSlashCommand(
    spaceId: Guid,
    channelId: Guid,
    commandId: Guid,
    options: { name: string; value: string }[],
  ): Promise<boolean> {
    try {
      const result = await api.channelInteraction.InvokeSlashCommand(
        spaceId,
        channelId,
        commandId,
        options as any,
      );
      if (result.isFailedInvokeSlashCommand()) {
        logger.error("InvokeSlashCommand failed:", result.error);
      }
      if (result.isSuccessInvokeSlashCommand()) {
        return true;
      }
      return false;
    } catch (error) {
      logger.error("InvokeSlashCommand error:", error);
      return false;
    }
  }

  function closeModal() {
    activeModal.value = null;
  }

  return {
    activeModal,
    pendingInteractions,
    subscribe,
    unsubscribe,
    interactWithControl,
    interactWithSelect,
    submitModal,
    invokeSlashCommand,
    closeModal,
  };
});
