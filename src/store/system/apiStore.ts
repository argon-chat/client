import { defineStore } from "pinia";
import { computed, ComputedRef, ref } from "vue";
import { useConfig } from "@/store/system/remoteConfig";
import { createClient } from "@argon/glue";
import { IonCallContext, IonInterceptor } from "@argon-chat/ion.webcore";
import { useAuthStore } from "@/store/auth/authStore";
import { readPersistedValue } from "@argon/storage";
import { v7 } from "uuid";
import { DEVICE_PROOF_HEADER, deviceProof } from "@/lib/net/deviceProofHeader";
import { CLIENT_DESCRIPTOR_HEADER, clientDescriptorHeader } from "@/lib/net/clientDescriptor";

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

/**
 * Carries a device proof to the one call that asked for it — see `withDeviceProof` in
 * `@/lib/net/deviceProofHeader` for the contract. Taken, not read: the server accepts each proof once.
 *
 * This interceptor is first in the chain so that the take happens in the synchronous prefix of the
 * call that set the proof, before anything else has had a chance to yield.
 */
export class DeviceProofInterceptor implements IonInterceptor {
  async invokeAsync(
    ctx: IonCallContext,
    next: (ctx: IonCallContext, signal?: AbortSignal) => Promise<void>,
    signal?: AbortSignal
  ): Promise<void> {
    const proof = deviceProof.pending;
    if (proof) {
      deviceProof.pending = null;
      ctx.requestHeaders = { ...ctx.requestHeaders, [DEVICE_PROOF_HEADER]: proof };
    }
    await next(ctx, signal);
  }
}

/**
 * Says what this client is on every request, so the server can name the session on the devices
 * screen. Built once; see `clientDescriptorHeader`. A request never fails over a header that only
 * describes the device.
 */
export class ClientDescriptorInterceptor implements IonInterceptor {
  async invokeAsync(
    ctx: IonCallContext,
    next: (ctx: IonCallContext, signal?: AbortSignal) => Promise<void>,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      const value = await clientDescriptorHeader();
      if (value) ctx.requestHeaders = { ...ctx.requestHeaders, [CLIENT_DESCRIPTOR_HEADER]: value };
    } catch {
      /* described below as best effort */
    }
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
    // DeviceProofInterceptor goes first on purpose — see its doc comment.
    return createClient(cfg.apiEndpoint, [
      new DeviceProofInterceptor(),
      new AuthInterceptor(authLazy),
      new LocaleInterceptor(),
      new ClientDescriptorInterceptor(),
    ]);
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
  const linkPreviewInteraction = computed(() => rpcClient.value.LinkPreviewInteraction);

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
    gifInteraction,
    linkPreviewInteraction
  };
});
