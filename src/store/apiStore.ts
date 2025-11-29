import { defineStore } from "pinia";
import { computed, ComputedRef } from "vue";
import { useConfig } from "./remoteConfig";
import { createClient } from "@/lib/glue/argonChat";
import { IonCallContext, IonInterceptor } from "@argon-chat/ion.webcore";
import { useAuthStore } from "./authStore";
import { v7 } from "uuid";

export function lazy<T>(getter: () => T): ComputedRef<T> {
  let initialized = false;
  let cached: ComputedRef<T>;

  return computed(() => {
    if (!initialized) {
      cached = computed(getter);
      initialized = true;
    }
    return cached.value;
  });
}

class AuthInterceptor implements IonInterceptor {
  constructor(public lazyStore: ComputedRef<ReturnType<typeof useAuthStore>>) {}
  async invokeAsync(
    ctx: IonCallContext,
    next: (ctx: IonCallContext, signal?: AbortSignal) => Promise<void>,
    signal?: AbortSignal
  ): Promise<void> {
    if (!localStorage.getItem("secref")) {
      localStorage.setItem("secref", v7());
    }
    if (!localStorage.getItem("seccarry")) {
      localStorage.setItem("seccarry", v7());
    }

    let authData = {} as any;

    if ( this.lazyStore.value.token) {
      authData.Authorization = `Bearer ${this.lazyStore.value.token}`;
    }
    
    ctx.requestHeadets = {
      ...ctx.requestHeadets,
      ...authData,
      'X-Sec-Ref': localStorage.getItem("secref")!,
      'X-Sec-Ner': '1',
      'X-Sec-Carry': localStorage.getItem("seccarry")!
    };
    await next(ctx, signal);
  }
}

export const useApi = defineStore("api", () => {
  const cfg = useConfig();
  const authLazy = lazy(() => useAuthStore());

  const rpcClient = computed(() =>
    createClient(cfg.apiEndpoint, [new AuthInterceptor(authLazy)])
  );

  const userInteraction = computed(() => rpcClient.value.UserInteraction);
  const identityInteraction = computed(() => rpcClient.value.IdentityInteraction);
  const inventoryInteraction = computed(() => rpcClient.value.InventoryInteraction);
  const serverInteraction = computed(() => rpcClient.value.ServerInteraction);
  const callInteraction = computed(() => rpcClient.value.CallInteraction);
  const archetypeInteraction = computed(
    () => rpcClient.value.ArchetypeInteraction
  );
  const channelInteraction = computed(() => rpcClient.value.ChannelInteraction);
  const eventBus = computed(() => rpcClient.value.EventBus);

  const getRawClient = () => rpcClient;

  
  (window as any).callInteraction = callInteraction;

  return {
    userInteraction,
    serverInteraction,
    channelInteraction,
    archetypeInteraction,
    inventoryInteraction,
    identityInteraction,
    eventBus,
    getRawClient,
    callInteraction
  };
});
