import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Output,
  WebMOutputFormat,
} from "mediabunny";
import { remux, type DownloadChoice } from "../src/download/remux";

// Synthetic encoded packets test container and timestamp integrity, not playback.
async function fixture() {
  const target = new BufferTarget(),
    output = new Output({ format: new WebMOutputFormat(), target });
  const video = new EncodedVideoPacketSource("vp8"),
    audio = new EncodedAudioPacketSource("opus");
  output.addVideoTrack(video);
  output.addAudioTrack(audio);
  await output.start();
  for (let i = 0; i < 4; i++) {
    await video.add(
      new EncodedPacket(
        new Uint8Array([0x10, 0, 0, 0x9d, 0x01, 0x2a, 16, 0, 16, 0, i]),
        "key",
        i / 25,
        1 / 25,
      ),
      i === 0
        ? { decoderConfig: { codec: "vp8", codedWidth: 16, codedHeight: 16 } }
        : undefined,
    );
    await audio.add(
      new EncodedPacket(
        new Uint8Array([0xf8, 0xff, 0xfe]),
        "key",
        i / 25,
        1 / 25,
      ),
      i === 0
        ? {
            decoderConfig: {
              codec: "opus",
              sampleRate: 48000,
              numberOfChannels: 2,
            },
          }
        : undefined,
    );
  }
  video.close();
  audio.close();
  await output.finalize();
  return new Uint8Array(target.buffer!);
}
const choice: DownloadChoice = {
  video: {
    itag: 1,
    url: "https://fixture.googlevideo.com/video",
    mimeType: "video/webm",
    height: 16,
    audioQuality: "test",
  },
  extension: "webm",
};
function disk() {
  let bytes = new Uint8Array(0);
  const write = vi.fn(async (chunk: { position: number; data: Uint8Array }) => {
    const end = chunk.position + chunk.data.byteLength;
    if (end > bytes.length) {
      const next = new Uint8Array(end);
      next.set(bytes);
      bytes = next;
    }
    bytes.set(chunk.data, chunk.position);
  });
  const close = vi.fn(async () => {}),
    abort = vi.fn(async () => {});
  return {
    writable: {
      write,
      close,
      abort,
    } as unknown as FileSystemWritableFileStream,
    bytes: () => bytes,
    write,
    close,
    abort,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("streaming media container writes", () => {
  it("preserves both encoded tracks and timestamps and closes a successful file", async () => {
    const source = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(source, {
            headers: {
              "Content-Length": String(source.length),
              "Content-Type": "video/webm",
            },
          }),
      ),
    );
    const file = disk();
    await remux(choice, file.writable, new AbortController().signal, () => {});
    expect(file.close).toHaveBeenCalledTimes(1);
    expect(file.abort).not.toHaveBeenCalled();
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BufferSource(file.bytes()),
    });
    try {
      const video = (await input.getPrimaryVideoTrack())!,
        audio = (await input.getPrimaryAudioTrack())!;
      expect(await video.getCodec()).toBe("vp8");
      expect(await audio.getCodec()).toBe("opus");
      const times: number[] = [];
      for await (const p of new EncodedPacketSink(video).packets())
        times.push(p.timestamp);
      expect(times).toEqual([0, 0.04, 0.08, 0.12]);
      let audioPackets = 0;
      for await (const _ of new EncodedPacketSink(audio).packets())
        audioPackets++;
      expect(audioPackets).toBe(4);
    } finally {
      input.dispose();
    }
  });
  it("aborts a file if Stop arrived before source reading began", async () => {
    const controller = new AbortController();
    controller.abort();
    const file = disk();
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      remux(choice, file.writable, controller.signal, () => {}),
    ).rejects.toThrow();
    expect(file.abort).toHaveBeenCalledTimes(1);
    expect(file.close).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("aborts rather than finalizing a failed download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 403 })),
    );
    const file = disk();
    await expect(
      remux(choice, file.writable, new AbortController().signal, () => {}),
    ).rejects.toThrow();
    expect(file.abort).toHaveBeenCalledTimes(1);
    expect(file.close).not.toHaveBeenCalled();
  });
});
