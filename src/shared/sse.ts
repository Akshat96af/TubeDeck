import { checkAbort } from "./utils";
export async function* readSSE(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<unknown> {
  checkAbort(signal);
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  const stop = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", stop, { once: true });
  function parse(block: string) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    return data && data !== "[DONE]" ? JSON.parse(data) : undefined;
  }
  try {
    while (true) {
      checkAbort(signal);
      const { value, done } = await reader.read();
      checkAbort(signal);
      buffer += decoder.decode(value, { stream: !done });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const event = parse(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (event !== undefined) yield event;
      }
      if (done) {
        if (buffer.trim()) {
          const event = parse(buffer);
          if (event !== undefined) yield event;
        }
        break;
      }
    }
  } finally {
    signal.removeEventListener("abort", stop);
    reader.releaseLock();
  }
}
