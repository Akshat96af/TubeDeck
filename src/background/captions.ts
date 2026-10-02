import { jsonCaptions } from "../shared/captions";
import { checkAbort } from "../shared/utils";

export async function readCaptions(
  tabId: number,
  videoId: string,
  signal: AbortSignal,
) {
  checkAbort(signal);
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "MAIN",
    func: (expected: string) => {
      if (new URL(location.href).searchParams.get("v") !== expected) return [];
      const w = window as any;
      const player = document.getElementById("movie_player") as any;
      let current;
      try {
        current = player?.getPlayerResponse?.();
      } catch {}
      return [current, w.ytInitialPlayerResponse]
        .filter((p) => p?.videoDetails?.videoId === expected)
        .flatMap(
          (p) =>
            p.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [],
        )
        .map((t) => ({
          url: t.baseUrl,
          language: t.languageCode,
          kind: t.kind,
        }));
    },
    args: [videoId],
  });
  const tracks = [
    ...new Map((results[0]?.result ?? []).map((t) => [t.url, t])).values(),
  ];
  tracks.sort(
    (a: any, b: any) =>
      Number(b.language === "en") - Number(a.language === "en") ||
      Number(a.kind === "asr") - Number(b.kind === "asr"),
  );
  for (const track of tracks.slice(0, 2)) {
    checkAbort(signal);
    try {
      const url = new URL(track.url);
      if (
        url.origin !== "https://www.youtube.com" ||
        url.username ||
        url.password ||
        url.pathname !== "/api/timedtext"
      )
        continue;
      url.searchParams.set("fmt", "json3");
      const response = await fetch(url, {
        credentials: "include",
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      });
      if (response.ok) return jsonCaptions(await response.json());
    } catch {
      checkAbort(signal);
    }
  }
  throw new Error(
    "Caption track unavailable; trying YouTube's transcript panel.",
  );
}
