import { defineStore } from "pinia";
import { computed, ComputedRef, ref } from "vue";
import { useConfig } from "@/store/system/remoteConfig";
import { createClient } from "@argon/glue";
import { IonCallContext, IonInterceptor } from "@argon-chat/ion.webcore";
import { useAuthStore } from "@/store/auth/authStore";
import { readPersistedValue } from "@argon/storage";
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
    let authData = {} as any;

    if ( this.lazyStore.value.token) {
      authData.Authorization = `Bearer ${this.lazyStore.value.token}`;
    }
    
    ctx.requestHeaders = {
      ...ctx.requestHeaders,
      ...authData,
    };
    await next(ctx, signal);
  }
}

// A non-reactive bearer interceptor for one-off clients (e.g. account enrollment against a target
// instance), where the token is a captured constant rather than the live active session.
export function staticBearerInterceptor(token: string): IonInterceptor {
  return {
    async invokeAsync(ctx, next, signal) {
      ctx.requestHeaders = {
        ...ctx.requestHeaders,
        Authorization: `Bearer ${token}`,
      };
      await next(ctx, signal);
    },
  };
}

// Threads the user's current app locale into every request so the backend (and bots)
// know which language to use. Read fresh per request so language switches take effect live.
export class LocaleInterceptor implements IonInterceptor {
  async invokeAsync(
    ctx: IonCallContext,
    next: (ctx: IonCallContext, signal?: AbortSignal) => Promise<void>,
    signal?: AbortSignal
  ): Promise<void> {
    ctx.requestHeaders = {
      ...ctx.requestHeaders,
      "x-argon-locale": readPersistedValue<string>("locale", "en"),
    };
    await next(ctx, signal);
  }
}

export const useApi = defineStore("api", () => {
  const cfg = useConfig();
  const authLazy = lazy(() => useAuthStore());

  // Bumped on a seamless account switch to force a brand-new client (fresh AbortController) so traffic
  // from the previous account can't carry over. The computed already rebuilds when apiEndpoint changes
  // (cross-instance switch); rpcEpoch covers the same-endpoint case (two official accounts).
  const rpcEpoch = ref(0);

  const rpcClient = computed(() => {
    void rpcEpoch.value;
    return createClient(cfg.apiEndpoint, [new AuthInterceptor(authLazy), new LocaleInterceptor()]);
  });

  function recycleClient() {
    rpcEpoch.value++;
  }

  const apiEndpoint = computed(() => cfg.apiEndpoint);

  const userInteraction = computed(() => rpcClient.value.UserInteraction);
  const securityInteraction = computed(() => rpcClient.value.SecurityInteraction);
  const identityInteraction = computed(
    () => rpcClient.value.IdentityInteraction
  );
  const inventoryInteraction = computed(
    () => rpcClient.value.InventoryInteraction
  );
  const serverInteraction = computed(() => rpcClient.value.ServerInteraction);
  const callInteraction = computed(() => rpcClient.value.CallInteraction);
  const freindsInteraction = computed(() => rpcClient.value.FriendsInteraction);
  const userChatInteractions = computed(
    () => rpcClient.value.UserChatInteractions
  );
  const archetypeInteraction = computed(
    () => rpcClient.value.ArchetypeInteraction
  );
  const channelInteraction = computed(() => rpcClient.value.ChannelInteraction);
  const eventBus = computed(() => rpcClient.value.EventBus);
  const featureFlagInteraction = computed(() => rpcClient.value.FeatureFlagInteractions);
  const privacyInteraction = computed(() => rpcClient.value.PrivacyInteraction);
  const botManagementInteraction = computed(() => rpcClient.value.BotManagementInteraction);
  const ultimaInteraction = computed(() => rpcClient.value.UltimaInteraction);
  const reportInteraction = computed(() => rpcClient.value.ReportInteraction);
  const gifInteraction = computed(() => rpcClient.value.GifInteraction);

  const getRawClient = () => rpcClient;

  (window as any).callInteraction = callInteraction;

  return {
    recycleClient,
    apiEndpoint,
    userInteraction,
    securityInteraction,
    serverInteraction,
    channelInteraction,
    archetypeInteraction,
    inventoryInteraction,
    identityInteraction,
    freindsInteraction,
    userChatInteractions,
    eventBus,
    getRawClient,
    callInteraction,
    featureFlagInteraction,
    privacyInteraction,
    botManagementInteraction,
    ultimaInteraction,
    reportInteraction,
    gifInteraction
  };
});
