import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { encode, decode } from "@msgpack/msgpack";
import { ArgonTransportClient } from "../proto/transport.client";
import { useAuthStore } from "@/store/authStore";
import { logger } from "../logger";
export class RpcClient {
  private client: ArgonTransportClient;

  constructor(baseUrl: string) {
    const transport = new GrpcWebFetchTransport({ baseUrl, format: "text" });
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

            logger.log(response);

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

            return {
              [Symbol.asyncIterator]: async function* () {
                for await (const response of stream.responses) {
                  if (response.payload.length === 0)
                    continue;
                  yield decode(response.payload) as IArgonEvent;
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
