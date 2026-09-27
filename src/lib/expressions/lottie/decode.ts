export const MAX_LOTTIE_JSON_BYTES = 8 * 1024 * 1024;

export class LottieTooLargeError extends Error {
  constructor(limit: number) {
    super(`Lottie JSON exceeds ${limit} bytes`);
    this.name = "LottieTooLargeError";
  }
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzip(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new LottieTooLargeError(limit);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** A TGS (gzipped Lottie) or plain Lottie JSON, as the JSON text. Stops reading past `limit` bytes. */
export async function decodeLottieBytes(
  input: ArrayBuffer | Uint8Array,
  limit = MAX_LOTTIE_JSON_BYTES,
): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const json = isGzip(bytes) ? await gunzip(bytes, limit) : bytes;
  if (json.byteLength > limit) throw new LottieTooLargeError(limit);
  return new TextDecoder().decode(json);
}
