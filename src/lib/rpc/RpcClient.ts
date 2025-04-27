import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { encode, decode } from "@msgpack/msgpack";
import { ArgonTransportClient } from "../proto/transport.client";
import { useAuthStore } from "@/store/authStore";
import { logger } from "../logger";
import { useSystemStore } from "@/store/systemStore";
import { fromEvent, tap } from "rxjs";
import delay from "../delay";
import { useMe } from "@/store/meStore";
import { useToast } from '@/components/ui/toast/'
import { v7 } from "uuid";
import { RemovableRef, useLocalStorage } from "@vueuse/core";
import { Ref, ref } from "vue";


export function buildAtUrl(
  upgrade: string,
  aat: string,
  sequence?: number,
  eventId?: number,
  srv?: string
) {
  const sys = useSystemStore();
  const args = [];

  if (srv) args.push(`&srv=${srv}`);
  if (sequence) args.push(`&sequence=${sequence}`);
  if (eventId) args.push(`&eventId=${eventId}`);

  const url = new URL(
    `${sys.preferUseWs ? `/$at.ws` : `/$at.wt`}?aat=${aat}${args.join()}`,
    `https://${upgrade}`
  );
  logger.warn('builded wt url', url, `upgrade: ${upgrade}`);
  return url;
}

export class WsStream {
  private socket: WebSocket;
  private reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(url: URL) {
    this.socket = new WebSocket(url);

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.socket.onmessage = (event) => controller.enqueue(event.data);
        this.socket.onclose = () => controller.close();
        this.socket.onerror = (e) => controller.error(e);
      },
    });

    this.reader = stream.getReader();
  }

  send(data: ArrayBufferLike) {
    this.socket.send(data);
  }

  async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
    return await this.reader.read();
  }

  close() {
    this.socket.close();
  }
}

export class RpcClient {
  private client: ArgonTransportClient;
  private baseUrl: string;
  private activeTransport: Ref<WritableStreamDefaultWriter<string | Uint8Array<ArrayBufferLike>> | null> = ref(null);

  constructor(baseUrl: string) {
    const transport = new GrpcWebFetchTransport({
      baseUrl,
      format: "text",
      timeout: 60000 * 10,
    });
    this.client = new ArgonTransportClient(transport);
    this.baseUrl = baseUrl;
    
  }

  getExtendedHeaders(): HeadersInit {
    if (argon.isArgonHost)
      return {};
    const sessionId = useLocalStorage("sessionId", v7(), { writeDefaults: true, initOnMounted: true });
    return {
      "X-Ctt": sessionId.value,
      "X-Ctf": import.meta.env.VITE_ARGON_FINGERPRINT
    }
  }

  async sendPackageToActieTransport<T>(pkg: T): Promise<void> {
    if (this.activeTransport.value) {
      await this.activeTransport.value.write(encode(pkg, {
         useBigInt64: true
      }));
    } else logger.warn("no active stream defined");
  }

  create<T>(serviceName: string): T {
    return new Proxy(
      {},
      {
        get: (_, methodName) => {
          return async (...args: any[]) => {
            const authStore = useAuthStore();
            const sys = useSystemStore();
            const payload = encode(args, {
              useBigInt64: true,
            });

            while (
              sys.hasRequestRetry("argon-transport", methodName.toString())
            ) {
              logger.warn("Awaiting unlock request retry trigger...");
              await delay(1000);
            }

            const maxRetries = 100;
            const baseDelay = 500;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
              if (attempt > 1) {
                sys.startRequestRetry("argon-transport", methodName.toString());
              }

              try {
                const headers = this.getExtendedHeaders();
                const response = await this.client.unary(
                  {
                    interface: serviceName,
                    method: String(methodName),
                    payload: payload,
                  },
                  { meta: { authorize: authStore.token ?? "", ...(headers as any) } }
                );

                if (response.response.statusCode == 2 && !!authStore.token) {
                  logger.warn("NOT AUTHORIZED, logout...");
                  const toast = useToast();

                  toast.toast({
                    duration: 7000,
                    title: "Authorization invalidated...",
                    description: "You authorization has invalidated, required new login...",
                    variant: "destructive"
                  });
                  await delay(7000);
                  authStore.logout();
                  window.location.reload()
                  throw "not authorized";
                }
                if (response.status.code !== "OK") {
                  throw new Error(
                    `${response.status.code} - ${response.status.detail || "Unknown error occurred."}`
                  );
                }

                if (response.response.statusCode !== 0) {
                  throw new Error(
                    `${response.response.statusCode} - ${response.response.errorMessage || "Unknown error occurred."}, ${response.response.exceptionType}`
                  );
                }

                if (response.response.payload.length === 0) return null;

                sys.stopRequestRetry("argon-transport", methodName.toString());
                const resposnse_data = decode(response.response.payload);

                logger.log(resposnse_data);
                return resposnse_data;
              } catch (error) {
                throw error;
                /*await new Promise((res) =>
                  setTimeout(res, baseDelay * Math.pow(2, attempt))
                );*/
              }
            }
          };
        },
      }
    ) as T;
  }

  eventBus<T>(): T {
    const sys = useSystemStore();
    if (sys.preferUseWs) return this.eventBusWs<T>();
    return this.eventBusWt<T>();
  }

  eventBusWs<T>(): T {
    const headers = this.getExtendedHeaders();
    const that = this;
    return new Proxy(
      {},
      {
        get: (_, methodName) => {
          return async (
            ...args: any[]
          ): Promise<AsyncIterable<IArgonEvent>> => {
            const authStore = useAuthStore();
            const wtUrl = new URL(`${this.baseUrl}/$at.http`, this.baseUrl);
            const baseAddr = this.baseUrl;
            const sys = useSystemStore();

            let sequence: number | undefined = undefined;
            let eventId: number | undefined = undefined;

            async function fetchTransportDetails() {
              const attResponse = await fetch(wtUrl, {
                method: "GET",
                headers: { Authorization: authStore.token!, ...headers },
              });

              if (!attResponse.ok) {
                logger.error(
                  `Error: ${attResponse.status} - ${attResponse.statusText}`
                );
                throw new Error("Failed to fetch transport details");
              }

              let upgrade = attResponse.headers.get("X-Wt-Upgrade")!;
              const aat = attResponse.headers.get("X-Wt-AAT")!;

              if (upgrade === "localhost") {
                upgrade = baseAddr.replace("https://", "");
              }

              
              const transportUrl = buildAtUrl(
                upgrade,
                aat,
                sequence,
                eventId,
                methodName === "SubscribeToMeEvents" ? null : args[0]
              );

              return { transportUrl };
            }

            return {
              [Symbol.asyncIterator]: async function* () {
                let reconnectDelay = 1000;

                while (true) {
                  let transport: WebSocketStream = null!;
                  const sub = fromEvent(window, "beforeunload")
                    .pipe(tap(() => transport?.close()))
                    .subscribe();

                  try {
                    const { transportUrl } = await fetchTransportDetails();

                    transport = new WebSocketStream(
                      transportUrl.toString(),
                      {}
                    );
                    const stream = await transport.opened;
                    const reader = stream.readable.getReader();
                    const eta = stream.writable.getWriter();
                    that.activeTransport.value = eta;

                    sys.stopRequestRetry("argon-transport-streams", "ws");
                    reconnectDelay = 1000;

                    while (true) {
                      const { value, done } = await reader.read();

                      if (typeof value === "string") throw new Error();

                      if (done) {
                        logger.warn("WebSocket stream ended.");
                        break;
                      }
                      if (value) {
                        try {
                          const buffer = new Uint8Array(value);

                          if (!buffer.length) continue;
                          yield decode(new Uint8Array(value)) as IArgonEvent;
                        } catch (e) {
                          logger.warn(
                            "Failed to process message, but continuing stream",
                            e
                          );
                        }
                      }
                    }
                  } catch (error) {
                    logger.error("WebSocket error:", error);
                  } finally {
                    sub.unsubscribe();
                    that.activeTransport.value = null;
                  }
                  sys.startRequestRetry("argon-transport-streams", "ws");
                  logger.warn(
                    `Reconnecting in ${reconnectDelay / 1000} seconds...`
                  );
                  await new Promise((resolve) =>
                    setTimeout(resolve, reconnectDelay)
                  );
                  reconnectDelay = Math.min(reconnectDelay * 2, 10000);
                }
              },
            };
          };
        },
      }
    ) as T;
  }
  eventBusWt<T>(): T {
    return new Proxy(
      {},
      {
        get: (_, methodName) => {
          return async (
            ...args: any[]
          ): Promise<AsyncIterable<IArgonEvent>> => {
            const authStore = useAuthStore();
            const wtUrl = new URL(`${this.baseUrl}/$at.http`, this.baseUrl);
            const baseAddr = this.baseUrl;
            const sys = useSystemStore();

            let sequence: number | undefined = undefined;
            let eventId: number | undefined = undefined;

            async function fetchTransportDetails() {
              const attResponse = await fetch(wtUrl, {
                method: "GET",
                headers: { Authorization: authStore.token! },
              });

              if (!attResponse.ok) {
                logger.error(
                  `Error: ${attResponse.status} - ${attResponse.statusText}`
                );
                throw new Error("Failed to fetch transport details");
              }

              let upgrade = attResponse.headers.get("X-Wt-Upgrade")!;
              const fingerprint = attResponse.headers.get("X-Wt-Fingerprint");
              const aat = attResponse.headers.get("X-Wt-AAT")!;

              if (upgrade === "localhost") {
                upgrade = baseAddr.replace("https://", "");
              }

              const transportUrl = buildAtUrl(
                upgrade,
                aat,
                sequence,
                eventId,
                methodName === "SubscribeToMeEvents" ? null : args[0]
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

              return { transportUrl, certs };
            }

            async function createTransport(
              transportUrl: URL,
              certs: WebTransportHash[]
            ) {
              const transport = new WebTransport(transportUrl.toString(), {
                congestionControl: "throughput",
                allowPooling: true,
                serverCertificateHashes: certs,
              });

              await transport.ready;
              logger.log("WebTransport connection established.");
              return transport;
            }

            return {
              [Symbol.asyncIterator]: async function* () {
                let reconnectDelay = 1000;

                while (true) {
                  let transport: WebTransport = null!;
                  const sub = fromEvent(window, "beforeunload")
                    .pipe(tap(() => transport?.close()))
                    .subscribe();
                  try {
                    const { transportUrl, certs } =
                      await fetchTransportDetails();
                    let transport = await createTransport(transportUrl, certs);
                    let stream = await transport.createBidirectionalStream();
                    let reader =
                      stream.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;

                    reconnectDelay = 1000;
                    sys.stopRequestRetry("argon-transport-streams", "wt");

                    while (true) {
                      const { value, done } = await reader.read();
                      logger.warn(value, done);

                      if (done) {
                        logger.warn("WebTransport stream ended.");
                        break;
                      }
                      if (value?.length) {
                        try {
                          yield decode(value) as IArgonEvent;
                        } catch (e) {
                          logger.warn(
                            "Failed to process message, but continuing stream",
                            e
                          );
                        }
                      }
                    }
                  } catch (error) {
                    logger.error("WebTransport error:", error);
                  } finally {
                    sub.unsubscribe();
                  }
                  sys.startRequestRetry("argon-transport-streams", "wt");
                  logger.warn(
                    `Reconnecting in ${reconnectDelay / 1000} seconds...`
                  );
                  await new Promise((resolve) =>
                    setTimeout(resolve, reconnectDelay)
                  );
                  reconnectDelay = Math.min(reconnectDelay * 2, 10000);
                }
              },
            };
          };
        },
      }
    ) as T;
  }
}
