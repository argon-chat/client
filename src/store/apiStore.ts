import { defineStore } from "pinia";
import { computed, ComputedRef } from "vue";
import { useConfig } from "./remoteConfig";
import { createClient } from "@/lib/glue/argonChat";
import { IonCallContext, IonInterceptor } from "@argon-chat/ion.webcore";
import { useAuthStore } from "./authStore";

export function lazy<T>(getter: () => T): ComputedRef<T> {
  let initialized = false
  let cached: ComputedRef<T>

  return computed(() => {
    if (!initialized) {
      cached = computed(getter)
      initialized = true
    }
    return cached.value
  })
}


class AuthInterceptor implements IonInterceptor {
  constructor(public lazyStore: ComputedRef<ReturnType<typeof useAuthStore>>) {}
  async invokeAsync(ctx: IonCallContext, next: (ctx: IonCallContext, signal?: AbortSignal) 
    => Promise<void>, signal?: AbortSignal): Promise<void> {
    ctx.requestHeadets = { ...ctx.requestHeadets, "Authorization": this.lazyStore.value.token! };
    await next(ctx, signal);
  }
}

export const useApi = defineStore("api", () => {
  const cfg = useConfig();
  const authLazy = lazy(() => useAuthStore());
  
  const rpcClient = computed(() => createClient(cfg.apiEndpoint, [new AuthInterceptor(authLazy)]));


  const userInteraction = computed(() =>
    rpcClient.value.UserInteraction
  );
  const serverInteraction = computed(() =>
    rpcClient.value.ServerInteraction
  );
  const archetypeInteraction = computed(() =>
    rpcClient.value.ArchetypeInteraction
  );
  const channelInteraction = computed(() =>
    rpcClient.value.ChannelInteraction
  );
  const eventBus = computed(() => rpcClient.value.EventBus);

  const getRawClient = () => rpcClient;

  return {
    userInteraction,
    serverInteraction,
    channelInteraction,
    archetypeInteraction,
    eventBus,
    getRawClient,
  };
});
