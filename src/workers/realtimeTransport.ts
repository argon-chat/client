import type { IonStreamOptions } from "@argon-chat/ion.webcore";

/**
 * How the realtime stream connects.
 *
 * WebTransport only when the instance advertises an endpoint for it: it is served on its own
 * origin (a UDP port of its own), so the `.wt` URL Ion builds from the API address is re-pointed
 * there, path and query kept. Without one, or where this browser has no WebTransport, WebSocket
 * alone — Ion would otherwise try WebTransport against the API origin first on every connect.
 */
export function realtimeStreamOptions(webTransportEndpoint: string | null | undefined): IonStreamOptions {
  if (!webTransportEndpoint || typeof WebTransport !== "function") return { transports: ["websocket"] };

  return {
    transports: ["webtransport", "websocket"],
    webTransportFactory: (url) => new WebTransport(withOrigin(url, webTransportEndpoint)),
  };
}

/** `url` with the scheme, host and port of `endpoint`; its own path and query untouched. */
export function withOrigin(url: string, endpoint: string): string {
  const target = new URL(url);
  const origin = new URL(endpoint);
  target.protocol = origin.protocol;
  target.hostname = origin.hostname;
  // Not `host`: setting a host without a port keeps the old port.
  target.port = origin.port;
  return target.toString();
}
