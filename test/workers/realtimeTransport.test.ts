/**
 * Which transports the realtime stream may use, and where WebTransport goes.
 *
 * WebTransport is served on an origin of its own (a UDP listener on another port), so the URL Ion
 * builds from the API address has to be re-pointed there — and only there: the path carries the
 * service and method, and the query carries the ticket.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { realtimeStreamOptions, withOrigin } from "@/workers/realtimeTransport";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("withOrigin", () => {
  test("moves the URL to the endpoint's origin, path and query untouched", () => {
    expect(
      withOrigin(
        "https://api.argon.gl/ion/IEventBus/Realtime.wt?ticket=abc&ver=2&sid=s1",
        "https://api.argon.gl:4433",
      ),
    ).toBe("https://api.argon.gl:4433/ion/IEventBus/Realtime.wt?ticket=abc&ver=2&sid=s1");
  });

  test("drops the API's own port when the endpoint uses the default one", () => {
    expect(withOrigin("https://localhost:5002/ion/IEventBus/Realtime.wt?ticket=t", "https://rt.argon.gl")).toBe(
      "https://rt.argon.gl/ion/IEventBus/Realtime.wt?ticket=t",
    );
  });

  test("ignores a path on the endpoint", () => {
    expect(withOrigin("https://api.test/ion/IEventBus/Realtime.wt?ticket=t", "https://wt.test:4433/ignored")).toBe(
      "https://wt.test:4433/ion/IEventBus/Realtime.wt?ticket=t",
    );
  });
});

describe("realtimeStreamOptions", () => {
  test("WebSocket only when the instance advertises no WebTransport endpoint", () => {
    vi.stubGlobal("WebTransport", class {});

    expect(realtimeStreamOptions(null)).toEqual({ transports: ["websocket"] });
    expect(realtimeStreamOptions(undefined)).toEqual({ transports: ["websocket"] });
  });

  test("WebSocket only where this browser has no WebTransport", () => {
    vi.stubGlobal("WebTransport", undefined);

    expect(realtimeStreamOptions("https://api.test:4433")).toEqual({ transports: ["websocket"] });
  });

  test("WebTransport first, on the advertised endpoint, then WebSocket", () => {
    const opened: string[] = [];
    vi.stubGlobal(
      "WebTransport",
      class {
        constructor(url: string) {
          opened.push(url);
        }
      },
    );

    const options = realtimeStreamOptions("https://api.test:4433");
    expect(options.transports).toEqual(["webtransport", "websocket"]);

    options.webTransportFactory!("https://api.test/ion/IEventBus/Realtime.wt?ticket=t&ver=2");
    expect(opened).toEqual(["https://api.test:4433/ion/IEventBus/Realtime.wt?ticket=t&ver=2"]);
  });
});
