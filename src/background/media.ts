import type { MediaInfo } from "../shared/types";
export async function readMedia(tabId: number): Promise<MediaInfo> {
  const result = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "MAIN",
    func: () => {
      const w = window as any;
      const player = document.getElementById("movie_player") as unknown as {
        getPlayerResponse?: () => any;
      } | null;
      const id = new URL(location.href).searchParams.get("v");
      const candidates = [
        (() => {
          try {
            return player?.getPlayerResponse?.();
          } catch {
            return undefined;
          }
        })(),
        w.ytInitialPlayerResponse,
        (() => {
          try {
            const raw = w.ytplayer?.config?.args?.player_response;
            return typeof raw === "string" ? JSON.parse(raw) : raw;
          } catch {
            return undefined;
          }
        })(),
      ];
      const matching = candidates.filter(
        (d) => d?.videoDetails?.videoId === id,
      );
      const data =
        matching.find(
          (d) =>
            d.streamingData?.formats?.length ||
            d.streamingData?.adaptiveFormats?.length,
        ) ?? matching[0];
      if (!data)
        return {
          videoId: id || "",
          formats: [],
          live: false,
          reason:
            "The current player did not expose downloadable media formats.",
        };
      return {
        videoId: id || "",
        formats: [
          ...matching.flatMap((d) => [
            ...(d.streamingData?.formats ?? []),
            ...(d.streamingData?.adaptiveFormats ?? []),
          ]),
        ].map((f) => ({
          itag: f.itag,
          url: f.url,
          mimeType: f.mimeType,
          qualityLabel: f.qualityLabel,
          width: f.width,
          height: f.height,
          bitrate: f.bitrate,
          audioQuality: f.audioQuality,
          contentLength: f.contentLength,
          signatureCipher: f.signatureCipher,
          cipher: f.cipher,
        })),
        live: Boolean(data.videoDetails?.isLiveContent),
        reason: data.playabilityStatus?.reason,
      };
    },
  });
  const media = result[0]?.result as MediaInfo | undefined;
  if (!media)
    throw new Error(
      "Could not inspect the player. Refresh the YouTube tab and retry.",
    );
  const byItag = new Map<number, (typeof media.formats)[number]>();
  for (const f of media.formats) {
    const previous = byItag.get(f.itag);
    if (!previous || (!previous.url && f.url)) byItag.set(f.itag, f);
  }
  return { ...media, formats: [...byItag.values()] };
}
