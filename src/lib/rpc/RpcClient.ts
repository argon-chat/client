import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { encode, decode } from "@msgpack/msgpack";
import { ArgonTransportClient } from "../proto/transport.client";
import { useAuthStore } from "@/store/authStore";
import { logger } from "../logger";
export class RpcClient {
  private client: ArgonTransportClient;
  private baseUrl: string;

  constructor(baseUrl: string) {
    const transport = new GrpcWebFetchTransport({
      baseUrl,
      format: "text",
      timeout: 60000 * 10,
    });
    this.client = new ArgonTransportClient(transport);
    this.baseUrl = baseUrl;
  }

  create<T>(serviceName: string): T {
    return new Proxy(
      {},
      {
        get: (_, methodName) => {
          return async (...args: any[]) => {
            const authStore = useAuthStore();
            const payload = encode(args, {
              useBigInt64: true,
            });

            const response = await this.client.unary(
              {
                interface: serviceName,
                method: String(methodName),
                payload: payload,
              },
              { meta: { authorize: authStore.token ?? "" } }
            );

            if (response.status.code != "OK") {
              throw new Error(
                `${response.status.code} - ${response.status.detail || "Unknown error occurred."}`
              );
            }

            if (response.response.payload.length === 0) return null;

            return decode(response.response.payload);
          };
        },
      }
    ) as T;
  }

  eventBus<T>(): T {
    return new Proxy(
      {},
      {
        get: (_, methodName) => {
          return async (
            ...args: any[]
          ): Promise<AsyncIterable<IArgonEvent>> => {
            const authStore = useAuthStore();
            const wtUrl = new URL(`${this.baseUrl}/$wt`, this.baseUrl);

            const attResponse = await fetch(wtUrl, {
              method: "GET",
              headers: {
                Authorization: authStore.token!,
              },
            });

            if (!attResponse.ok) {
              logger.error(
                `Error: ${attResponse.status} - ${attResponse.statusText}`
              );
              throw new Error();
            }

            logger.log(attResponse);

            let upgrade = attResponse.headers.get("X-Wt-Upgrade");
            const fingerprint = attResponse.headers.get("X-Wt-Fingerprint");
            const aat = attResponse.headers.get("X-Wt-AAT");

            logger.warn(
              `Upgrade: ${upgrade} with ${fingerprint} fingerprint, using ${aat} AAT`
            );

            if (upgrade === "localhost") {
              upgrade = this.baseUrl.replace("https://", "");
            }

            const transportUrl =
              methodName === "SubscribeToMeEvents"
                ? new URL(`transport.wt?aat=${aat}`, `https://${upgrade}`)
                : new URL(
                    `transport.wt?aat=${aat}&srv=${args[0]}`,
                    `https://${upgrade}`
                  );

            const certs: WebTransportHash[] = [];

            if (fingerprint) {
              certs.push({
                value: Uint8Array.from(atob(fingerprint), (c) =>
                  c.charCodeAt(0)
                ),
                algorithm: "sha-256",
              });
            }

            function createWt() {
              return new WebTransport(transportUrl.toString(), {
                congestionControl: "throughput",
                allowPooling: true,
                serverCertificateHashes: certs,
              });
            }

            let transport = createWt();

            await transport.ready;
            logger.log("WebTransport connection established.");

            const beforeUnloadHandler = (event: BeforeUnloadEvent) => {
              transport.close({ reason: "end", closeCode: 200 });
              //event.preventDefault();
            };
            window.addEventListener("beforeunload", beforeUnloadHandler);
            return {
              [Symbol.asyncIterator]: async function* () {
                const start = performance.now();
                let stream = await transport.createBidirectionalStream();
                let reader = stream.readable.getReader();
                while (true) {
                  try {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value && value.length > 0) {
                      try {
                        yield decode(value) as IArgonEvent;
                      } catch (e) {
                        logger.warn(
                          "Failed processing message, but stream is continue"
                        );
                      }
                    }
                    continue;
                  } catch (error) {
                    logger.error("WebTransport stream error:", error);
                  } 

                  const end = performance.now();
                  logger.log(
                    `WebTransport stream closed, elapsed: ${(end - start) / 1000} seconds`
                  );
                  reader.releaseLock();
                  transport.close();
                  transport = createWt();
                  await transport.ready;
                  stream = await transport.createBidirectionalStream();
                  reader = stream.readable.getReader();
                }
              },
            };
          };
        },
      }
    ) as T;
  }

  async *subscribe(
    serviceName: string,
    methodName: string,
    args: any[]
  ): AsyncIterable<IArgonEvent> {
    const authStore = useAuthStore();
    const payload = encode(args);

    const stream = this.client.broadcastSubscribe(
      {
        interface: serviceName,
        method: methodName,
        payload: payload,
      },
      { meta: { authorize: authStore.token ?? "" } }
    );

    for await (const r of stream.responses) {
      yield decode(r.payload) as IArgonEvent;
    }
  }
}
