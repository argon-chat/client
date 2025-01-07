import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { encode, decode } from "@msgpack/msgpack";
import { ArgonTransportClient } from "../proto/transport.client";
import { useAuthStore } from "@/store/authStore";
import { logger } from "../logger";
export class RpcClient {
  private client: ArgonTransportClient;

  constructor(baseUrl: string) {
    const transport = new GrpcWebFetchTransport({ baseUrl, format: "text", timeout: 60000 * 10 });
    this.client = new ArgonTransportClient(transport);
  }

  create<T>(serviceName: string): T {
    return new Proxy(
      {},
      {
        get: (_, methodName) => {
          return async (...args: any[]) => {
            const authStore = useAuthStore();
            const payload = encode(args, {
              useBigInt64: true
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

            if (response.response.payload.length === 0)
              return null;

            return decode(response.response.payload);
          };
        },
      }
    ) as T;
  }

  eventBus<T>(serviceName: string): T {
    return new Proxy(
      {},
      {
        get: (_, methodName) => {
          return async (
            ...args: any[]
          ): Promise<AsyncIterable<IArgonEvent>> => {
            const authStore = useAuthStore();
            const payload = encode(args);

            const stream = this.client.broadcastSubscribe(
              {
                interface: serviceName,
                method: String(methodName),
                payload: payload,
              },
              { meta: { authorize: authStore.token ?? "" } }
            );
            (window as any)["subscribe_bi"] = this.subscribe_bi;
            this.subscribe_bi(serviceName, String(methodName), args);

            return {
              [Symbol.asyncIterator]: async function* () {
                const start = performance.now();
                try {
                  
                  for await (const response of stream.responses) {
                    if (response.payload.length === 0)
                      continue;
                    yield decode(response.payload) as IArgonEvent;
                  }
                } catch (error) {
                  logger.error("Stream connection lost or an error occurred:", error);
            
                } finally {
                  const end = performance.now();
                  logger.log(`Stream has been closed or completed, startTime: ${start}, endTime: ${end}, elapsed: ${(end - start) / 1000} seconds`);
                }
              },
            };
          };
        },
      }
    ) as T;
  }

  async subscribe_bi(
    serviceName: string,
    methodName: string,
    args: any[]
  ) {
    const authStore = useAuthStore();
    const payload = encode(args);

    const stream = this.client.biDirectSubscribe(
      { meta: { authorize: authStore.token ?? "" } }
    );

    setInterval(() => {
      stream.requests.send({
        interface: serviceName,
        method: methodName,
        payload: payload,
      });
      console.log("send success");
    }, 100);

    for await (const r of stream.responses) {
      console.log("bi direct called return", r);
    }
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
