import { defineStore } from "pinia";
import { computed } from "vue";
import { useConfig } from "./remoteConfig";
import { RpcClient } from "@/lib/rpc/RpcClient";

export const useApi = defineStore("api", () => {
  const cfg = useConfig();
  const rpcClient = computed(() => new RpcClient(cfg.apiEndpoint));
  const userInteraction = computed(() =>
    rpcClient.value.create<IUserInteraction>("IUserInteraction"),
  );
  const serverInteraction = computed(() =>
    rpcClient.value.create<IServerInteraction>("IServerInteraction"),
  );

  const eventBus = computed(() => rpcClient.value.eventBus<IEventBus>());

  const getRawClient = () => rpcClient;

  return {
    userInteraction,
    serverInteraction,
    eventBus,
    getRawClient,
  };
});
