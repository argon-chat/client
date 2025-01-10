import {
  RpcTransport,
  RpcOptions,
  MethodInfo,
  RpcOutputStreamController,
  RpcStatus,
  UnaryCall,
  ServerStreamingCall,
  RpcMetadata,
  // другие необходимые импорты
} from "@protobuf-ts/runtime-rpc";

export class WebTransportRpc implements RpcTransport {
  private session: WebTransport | null = null;

  constructor(private baseUrl: string) {}

  async connect(): Promise<void> {
    if (!this.session) {
      this.session = new WebTransport(this.baseUrl, {  });
      await this.session.ready;
    }
  }

  serverStreaming<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions
  ): ServerStreamingCall<I, O> {
    if (!this.session) {
      throw new Error("WebTransport session is not initialized. Call connect() first.");
    }

    const outputStream = new RpcOutputStreamController<O>();
    const headers = Promise.resolve<RpcMetadata>({});
    const trailers = new Promise<RpcMetadata>((resolve) => {
      // Если нет трейлеров, передаем пустой объект
      resolve({});
    });

    this.handleStreamingRequest(method, input, options, outputStream).catch((err) => {
      outputStream.notifyError(err);
    });

    return new ServerStreamingCall(
      method,
      options.meta!,
      input,
      headers,
      outputStream,
      Promise.resolve({ code: "OK" } as RpcStatus),
      trailers
    );
  }
  private async handleStreamingRequest<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions,
    outputStream: RpcOutputStreamController<O>
  ): Promise<void> {
    const stream = await this.session!.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    try {
      const requestPayload = method.I.toBinary(input);
      await writer.write(requestPayload);
      writer.close();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          const response = method.O.fromBinary(new Uint8Array(value));
          outputStream.notifyMessage(response);
        }
      }

      outputStream.notifyComplete();
    } catch (error: any) {
      outputStream.notifyError(error);
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
  }

  async destroy(): Promise<void> {
    if (this.session) {
      await this.session.close();
      this.session = null;
    }
  }

  mergeOptions(options: RpcOptions): RpcOptions {
    return { ...options };
  }
}
