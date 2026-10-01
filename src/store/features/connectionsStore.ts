import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { logger } from "@argon/core";
import type { IonPartial } from "@argon-chat/ion.webcore";
import {
  BeginConnectError,
  ConnectionError,
  ConnectReturnKind,
  ListenAlongEndReason,
  ListenAlongError,
  type ConnectionOptions,
  type ConnectionProvider,
  type ConnectionProviderInfo,
  type ListenAlongChanged,
  type ListenAlongEnded,
  type ListenAlongState,
  type ProfileConnection,
  type UserConnection,
  type UserConnectionsUpdated,
} from "@argon/glue";
import { argon } from "@argon/glue";
import { native } from "@argon/glue/native";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { useLocale } from "@/store/system/localeStore";
import { useToast } from "@argon/ui/toast";
import { openExternalUrl } from "@/lib/linkPreview/openExternal";
import { sortByProvider } from "@/lib/connections/providers";

/** The translation key for a listen-along refusal. */
export const LISTEN_ALONG_ERROR_KEYS: Record<ListenAlongError, string> = {
  [ListenAlongError.NONE]: "listen_along_error_unknown",
  [ListenAlongError.SPOTIFY_NOT_LINKED]: "listen_along_error_not_linked",
  [ListenAlongError.PREMIUM_REQUIRED]: "listen_along_error_premium",
  [ListenAlongError.SCOPE_MISSING]: "listen_along_error_scope",
  [ListenAlongError.NO_ACTIVE_DEVICE]: "listen_along_error_no_device",
  [ListenAlongError.HOST_NOT_PLAYING]: "listen_along_error_host_not_playing",
  [ListenAlongError.HOST_DISALLOWS]: "listen_along_error_host_disallows",
  [ListenAlongError.NOT_VISIBLE]: "listen_along_error_not_visible",
  [ListenAlongError.ALREADY_LISTENING]: "listen_along_error_already",
  [ListenAlongError.FULL]: "listen_along_error_full",
  [ListenAlongError.RATE_LIMITED]: "listen_along_error_rate_limited",
  [ListenAlongError.PROVIDER_ERROR]: "listen_along_error_unknown",
};

/** Why a listen-along ended, as the listener is told. LEFT is their own doing and says nothing. */
export const LISTEN_ALONG_END_KEYS: Partial<Record<ListenAlongEndReason, string>> = {
  [ListenAlongEndReason.HOST_STOPPED]: "listen_along_ended_host_stopped",
  [ListenAlongEndReason.HOST_OFFLINE]: "listen_along_ended_host_offline",
  [ListenAlongEndReason.HOST_DISALLOWED]: "listen_along_ended_host_disallowed",
  [ListenAlongEndReason.NO_ACTIVE_DEVICE]: "listen_along_ended_no_device",
  [ListenAlongEndReason.PROVIDER_ERROR]: "listen_along_ended_error",
};

export const BEGIN_CONNECT_ERROR_KEYS: Record<BeginConnectError, string> = {
  [BeginConnectError.NONE]: "connections_error_unknown",
  [BeginConnectError.PROVIDER_DISABLED]: "connections_error_disabled",
  [BeginConnectError.PROVIDER_ALREADY_LINKED]: "connections_error_already_linked",
  [BeginConnectError.RATE_LIMITED]: "connections_error_rate_limited",
  [BeginConnectError.INTERNAL_ERROR]: "connections_error_unknown",
  [BeginConnectError.CONNECTION_SUSPENDED]: "connections_error_suspended",
};

export const CONNECTION_ERROR_KEYS: Record<ConnectionError, string> = {
  [ConnectionError.NONE]: "connections_error_unknown",
  [ConnectionError.NOT_LINKED]: "connections_error_not_linked",
  [ConnectionError.NEEDS_REAUTH]: "connections_error_needs_reauth",
  [ConnectionError.COOLDOWN]: "connections_error_cooldown",
  [ConnectionError.OPTION_NOT_SUPPORTED]: "connections_error_option",
  [ConnectionError.PROVIDER_ERROR]: "connections_error_provider",
  [ConnectionError.INTERNAL_ERROR]: "connections_error_unknown",
};

/**
 * The caller's linked accounts and listen-along party.
 *
 * Linking happens in the system browser: `connect` asks the server for the provider's sign-in page
 * and opens it, and the result comes back as `UserConnectionsUpdated` on this account's own
 * stream. Nothing is polled; a missed event is covered by reloading when the settings page is
 * shown or the window regains focus while a sign-in is pending.
 */
export const useConnectionsStore = defineStore("connections", () => {
  const api = useApi();

  const providers = ref<ConnectionProviderInfo[]>([]);
  const mine = ref<UserConnection[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  /** The provider whose browser sign-in was started from here and has not come back yet. */
  const pending = ref<ConnectionProvider | null>(null);
  const listenAlong = ref<ListenAlongState | null>(null);

  const linkedProviders = computed(() => new Set(mine.value.map((c) => c.provider)));
  const available = computed(() => sortByProvider(providers.value).filter((p) => !linkedProviders.value.has(p.provider)));
  const capabilitiesOf = (provider: ConnectionProvider) =>
    providers.value.find((p) => p.provider === provider)?.capabilities ?? 0;

  let subscribed = false;

  /** Once per app: the events are personal, so they arrive wherever the user is. */
  function subscribe() {
    if (subscribed) return;
    subscribed = true;

    const bus = useBus();

    bus.onServerEvent<UserConnectionsUpdated>("UserConnectionsUpdated", (e) => apply([...e.connections]));

    bus.onServerEvent<ListenAlongChanged>("ListenAlongChanged", (e) => {
      listenAlong.value = e.listeners.length > 0
        ? { hostUserId: e.hostUserId, listeners: [...e.listeners], track: e.track }
        : null;
    });

    bus.onServerEvent<ListenAlongEnded>("ListenAlongEnded", (e) => {
      if (listenAlong.value?.hostUserId === e.hostUserId) listenAlong.value = null;

      const key = LISTEN_ALONG_END_KEYS[e.reason];
      if (key) {
        const { t } = useLocale();
        useToast().toast({ title: t("listen_along_ended"), description: t(key) });
      }
    });
  }

  function apply(connections: UserConnection[]) {
    mine.value = sortByProvider(connections);
    loaded.value = true;
    if (pending.value !== null && linkedProviders.value.has(pending.value)) pending.value = null;
  }

  async function load(): Promise<void> {
    subscribe();
    loading.value = true;
    try {
      const [offered, linked] = await Promise.all([
        api.connectionsInteraction.GetProviders(),
        api.connectionsInteraction.GetMyConnections(),
      ]);
      providers.value = [...offered];
      apply([...linked]);
    } catch (e) {
      logger.error("[connections] failed to load", e);
    } finally {
      loading.value = false;
    }
  }

  /** The server's return-to hint: the desktop app gets an argon:// link back, the web a page to close. */
  function returnKind(): ConnectReturnKind {
    return argon?.isArgonHost || native?.hostProc ? ConnectReturnKind.DESKTOP : ConnectReturnKind.WEB;
  }

  /**
   * Starts a browser sign-in. NONE when the browser was opened; otherwise the refusal, so the page
   * can offer to replace an account already linked.
   */
  async function connect(provider: ConnectionProvider, replace = false): Promise<BeginConnectError> {
    subscribe();
    const result = await api.connectionsInteraction.BeginConnect(provider, returnKind(), replace);
    if (result.isFailedBeginConnect()) return result.error;
    if (!result.isSuccessBeginConnect()) return BeginConnectError.INTERNAL_ERROR;

    pending.value = provider;
    openExternalUrl(result.url);
    return BeginConnectError.NONE;
  }

  function cancelPending() {
    pending.value = null;
  }

  async function disconnect(provider: ConnectionProvider): Promise<boolean> {
    const done = await api.connectionsInteraction.Disconnect(provider);
    if (done) mine.value = mine.value.filter((c) => c.provider !== provider);
    return done;
  }

  async function updateOptions(provider: ConnectionProvider, patch: IonPartial<ConnectionOptions>): Promise<ConnectionError> {
    const result = await api.connectionsInteraction.UpdateOptions(provider, patch);
    if (result.isSuccessUpdateConnection()) {
      replace(result.connection);
      return ConnectionError.NONE;
    }
    return result.isFailedUpdateConnection() ? result.error : ConnectionError.INTERNAL_ERROR;
  }

  async function refresh(provider: ConnectionProvider): Promise<ConnectionError> {
    const result = await api.connectionsInteraction.RefreshConnection(provider);
    if (result.isSuccessRefreshConnection()) {
      replace(result.connection);
      return ConnectionError.NONE;
    }
    return result.isFailedRefreshConnection() ? result.error : ConnectionError.INTERNAL_ERROR;
  }

  function replace(connection: UserConnection) {
    mine.value = sortByProvider([...mine.value.filter((c) => c.provider !== connection.provider), connection]);
  }

  /** Someone else's connections, for a card that was not handed them with the profile. */
  async function connectionsOf(userId: string): Promise<ProfileConnection[]> {
    try {
      return sortByProvider([...(await api.connectionsInteraction.GetUserConnections(userId))]);
    } catch (e) {
      logger.warn("[connections] failed to load a user's connections", e);
      return [];
    }
  }

  async function joinListenAlong(hostUserId: string): Promise<ListenAlongError> {
    subscribe();
    const result = await api.connectionsInteraction.JoinListenAlong(hostUserId);
    if (result.isSuccessListenAlong()) {
      listenAlong.value = result.state;
      return ListenAlongError.NONE;
    }
    return result.isFailedListenAlong() ? result.error : ListenAlongError.PROVIDER_ERROR;
  }

  async function leaveListenAlong(): Promise<void> {
    try {
      await api.connectionsInteraction.LeaveListenAlong();
    } finally {
      listenAlong.value = null;
    }
  }

  async function loadListenAlong(): Promise<void> {
    subscribe();
    try {
      listenAlong.value = await api.connectionsInteraction.GetListenAlongState();
    } catch (e) {
      logger.warn("[connections] failed to load the listen-along state", e);
    }
  }

  function isListeningAlongWith(hostUserId: string, myUserId: string | undefined): boolean {
    const party = listenAlong.value;
    return !!party && !!myUserId && party.hostUserId === hostUserId && party.listeners.includes(myUserId);
  }

  onSessionReset(() => {
    providers.value = [];
    mine.value = [];
    loaded.value = false;
    pending.value = null;
    listenAlong.value = null;
  });

  return {
    providers,
    mine,
    loaded,
    loading,
    pending,
    listenAlong,
    available,
    capabilitiesOf,
    subscribe,
    apply,
    load,
    connect,
    cancelPending,
    disconnect,
    updateOptions,
    refresh,
    connectionsOf,
    joinListenAlong,
    leaveListenAlong,
    loadListenAlong,
    isListeningAlongWith,
  };
});
