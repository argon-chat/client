/**
 * Linked accounts on the client: what the provider helpers make of the server's facts and tracks,
 * and what the store does with the three personal events and its own calls.
 *
 * The store is the only place the browser hand-off lives — `connect` opens the provider's page and
 * the result comes back as an event — so the event half is what keeps the settings page honest.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { IonDateTime } from "@argon-chat/ion.webcore";
import {
  BeginConnectError,
  ConnectionCapability,
  ConnectionDetailKind,
  ConnectionProvider,
  ConnectionStatus,
  ListenAlongEndReason,
  ListenAlongError,
} from "@argon/glue";

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: any) => void>(),
  api: {} as Record<string, any>,
  opened: [] as string[],
  toasts: [] as any[],
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ connectionsInteraction: h.api }),
}));

vi.mock("@/store/realtime/busStore", () => ({
  useBus: () => ({ onServerEvent: (key: string, cb: (e: any) => void) => h.handlers.set(key, cb) }),
}));

vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

vi.mock("@argon/ui/toast", () => ({
  useToast: () => ({ toast: (t: any) => h.toasts.push(t) }),
}));

vi.mock("@/lib/linkPreview/openExternal", () => ({
  openExternalUrl: (url: string) => h.opened.push(url),
}));

import { useConnectionsStore } from "@/store/features/connectionsStore";
import {
  detailSlug,
  formatDetailValue,
  formatTrackTime,
  hasCapability,
  instantMs,
  sortByProvider,
  trackProgress,
  visibleDetails,
} from "@/lib/connections/providers";

const connection = (provider: ConnectionProvider, name = "someone") => ({
  provider,
  externalId: `${provider}-id`,
  name,
  url: null,
  avatarUrl: null,
  verified: true,
  status: ConnectionStatus.ACTIVE,
  options: { displayOnProfile: true, showDetails: true, displayAsStatus: false, allowListenAlong: true },
  details: [],
  linkedAt: IonDateTime.now(),
  detailsRefreshedAt: null,
});

const track = (progressMs: number, durationMs: number, observedMs: number, isPlaying = true) => ({
  trackId: "t1",
  title: "Song",
  artists: ["Band"],
  album: "Album",
  albumArtUrl: null,
  durationMs,
  progressMs,
  observedAt: IonDateTime.fromDate(new Date(observedMs)),
  isPlaying,
  contextUri: null,
  url: "https://open.spotify.com/track/t1",
  listenAlongOpen: true,
});

describe("provider helpers", () => {
  test("a detail key is flattened into one translation key", () => {
    expect(detailSlug("steam.games")).toBe("steam_games");
    expect(detailSlug("github.public_repos")).toBe("github_public_repos");
    expect(detailSlug("since")).toBe("since");
  });

  test("numbers, dates and flags read like facts", () => {
    expect(formatDetailValue({ key: "steam.games", value: "245", kind: ConnectionDetailKind.NUMBER }, "en")).toBe("245");
    expect(formatDetailValue({ key: "youtube.subscribers", value: "2350000", kind: ConnectionDetailKind.NUMBER }, "en")).toBe("2.4M");
    expect(formatDetailValue({ key: "since", value: "2012-03-04", kind: ConnectionDetailKind.DATE }, "en")).toBe("Mar 2012");
    expect(formatDetailValue({ key: "x", value: "not a number", kind: ConnectionDetailKind.NUMBER }, "en")).toBe("not a number");

    const shown = visibleDetails([
      { key: "spotify.premium", value: "false", kind: ConnectionDetailKind.FLAG },
      { key: "twitter.verified", value: "true", kind: ConnectionDetailKind.FLAG },
      { key: "since", value: "2012-03-04", kind: ConnectionDetailKind.DATE },
    ]);
    expect(shown.map((d) => d.key)).toEqual(["twitter.verified", "since"]);
  });

  test("capabilities are flags", () => {
    const spotify = ConnectionCapability.DETAILS | ConnectionCapability.STATUS | ConnectionCapability.LISTEN_ALONG;
    expect(hasCapability(spotify, ConnectionCapability.LISTEN_ALONG)).toBe(true);
    expect(hasCapability(ConnectionCapability.DETAILS, ConnectionCapability.STATUS)).toBe(false);
  });

  test("providers sort in the offered order", () => {
    const sorted = sortByProvider([
      { provider: ConnectionProvider.TELEGRAM },
      { provider: ConnectionProvider.GITHUB },
      { provider: ConnectionProvider.SPOTIFY },
    ]);
    expect(sorted.map((x) => x.provider)).toEqual([ConnectionProvider.SPOTIFY, ConnectionProvider.GITHUB, ConnectionProvider.TELEGRAM]);
  });

  test("a playing track runs on from where the server saw it, a paused one stands still", () => {
    const t0 = 1_800_000_000_000;

    expect(trackProgress(track(10_000, 200_000, t0), t0 + 30_000)).toEqual({ positionMs: 40_000, durationMs: 200_000, fraction: 0.2 });
    expect(trackProgress(track(10_000, 200_000, t0, false), t0 + 30_000).positionMs).toBe(10_000);
    expect(trackProgress(track(195_000, 200_000, t0), t0 + 30_000).positionMs).toBe(200_000);
  });

  test("a datetime that lost its class in IndexedDB still has an instant", () => {
    const at = IonDateTime.fromDate(new Date(1_800_000_000_000));
    const cloned = { unixTicks: at.unixTicks, offsetMinutes: 0 };

    expect(instantMs(at)).toBe(1_800_000_000_000);
    expect(instantMs(cloned)).toBe(1_800_000_000_000);
  });

  test("track times read as m:ss, or h:mm:ss past an hour", () => {
    expect(formatTrackTime(0)).toBe("0:00");
    expect(formatTrackTime(61_500)).toBe("1:01");
    expect(formatTrackTime(3_725_000)).toBe("1:02:05");
  });
});

describe("connections store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    h.handlers.clear();
    h.opened = [];
    h.toasts = [];
    h.api = {
      GetProviders: vi.fn(async () => [
        { provider: ConnectionProvider.GITHUB, capabilities: ConnectionCapability.DETAILS },
        { provider: ConnectionProvider.SPOTIFY, capabilities: ConnectionCapability.DETAILS | ConnectionCapability.STATUS },
      ]),
      GetMyConnections: vi.fn(async () => [connection(ConnectionProvider.GITHUB)]),
      BeginConnect: vi.fn(async () => ({
        isSuccessBeginConnect: () => true,
        isFailedBeginConnect: () => false,
        url: "https://accounts.spotify.com/authorize?state=s",
      })),
      JoinListenAlong: vi.fn(),
      LeaveListenAlong: vi.fn(async () => {}),
    };
  });

  test("loading lists what is linked and offers the rest", async () => {
    const store = useConnectionsStore();

    await store.load();

    expect(store.mine.map((c) => c.provider)).toEqual([ConnectionProvider.GITHUB]);
    expect(store.available.map((p) => p.provider)).toEqual([ConnectionProvider.SPOTIFY]);
    expect(store.capabilitiesOf(ConnectionProvider.SPOTIFY)).toBe(ConnectionCapability.DETAILS | ConnectionCapability.STATUS);
  });

  test("connecting opens the provider's page and the event that comes back ends the wait", async () => {
    const store = useConnectionsStore();
    await store.load();

    expect(await store.connect(ConnectionProvider.SPOTIFY)).toBe(BeginConnectError.NONE);
    expect(h.opened).toEqual(["https://accounts.spotify.com/authorize?state=s"]);
    expect(store.pending).toBe(ConnectionProvider.SPOTIFY);

    h.handlers.get("UserConnectionsUpdated")!({
      userId: "me",
      connections: [connection(ConnectionProvider.GITHUB), connection(ConnectionProvider.SPOTIFY)],
    });

    expect(store.pending).toBeNull();
    expect(store.mine.map((c) => c.provider)).toEqual([ConnectionProvider.SPOTIFY, ConnectionProvider.GITHUB]);
    expect(store.available).toEqual([]);
  });

  test("a refusal is handed back and nothing is opened", async () => {
    const store = useConnectionsStore();
    h.api.BeginConnect = vi.fn(async () => ({
      isSuccessBeginConnect: () => false,
      isFailedBeginConnect: () => true,
      error: BeginConnectError.PROVIDER_ALREADY_LINKED,
    }));

    expect(await store.connect(ConnectionProvider.GITHUB)).toBe(BeginConnectError.PROVIDER_ALREADY_LINKED);
    expect(h.opened).toEqual([]);
    expect(store.pending).toBeNull();
  });

  test("listen along follows the party events and tells the listener why it ended", async () => {
    const store = useConnectionsStore();
    store.subscribe();

    h.api.JoinListenAlong = vi.fn(async () => ({
      isSuccessListenAlong: () => true,
      isFailedListenAlong: () => false,
      state: { hostUserId: "host", listeners: ["me"], track: null },
    }));

    expect(await store.joinListenAlong("host")).toBe(ListenAlongError.NONE);
    expect(store.isListeningAlongWith("host", "me")).toBe(true);

    h.handlers.get("ListenAlongChanged")!({ hostUserId: "host", listeners: ["me", "other"], track: null });
    expect(store.listenAlong?.listeners).toEqual(["me", "other"]);

    h.handlers.get("ListenAlongEnded")!({ hostUserId: "host", reason: ListenAlongEndReason.NO_ACTIVE_DEVICE });
    expect(store.listenAlong).toBeNull();
    expect(h.toasts.map((t) => t.description)).toEqual(["listen_along_ended_no_device"]);

    // Leaving is the listener's own doing and says nothing.
    h.handlers.get("ListenAlongEnded")!({ hostUserId: "host", reason: ListenAlongEndReason.LEFT });
    expect(h.toasts).toHaveLength(1);
  });

  test("a refused join is handed back with its reason", async () => {
    const store = useConnectionsStore();
    h.api.JoinListenAlong = vi.fn(async () => ({
      isSuccessListenAlong: () => false,
      isFailedListenAlong: () => true,
      error: ListenAlongError.PREMIUM_REQUIRED,
    }));

    expect(await store.joinListenAlong("host")).toBe(ListenAlongError.PREMIUM_REQUIRED);
    expect(store.listenAlong).toBeNull();
  });
});
