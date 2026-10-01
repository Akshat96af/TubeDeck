import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ChevronRight,
  LoaderCircle,
  Play,
  Square,
} from "lucide-react";
import { bridge } from "../ui/rpc";
import type { MediaInfo, Snapshot } from "../shared/types";
import { safeFilename, timeLabel, checkAbort } from "../shared/utils";
import { choices, remux, type DownloadChoice } from "./remux";
import "../ui/styles.css";
declare global {
  interface Window {
    showSaveFilePicker(options: {
      suggestedName: string;
      types: { description: string; accept: Record<string, string[]> }[];
    }): Promise<FileSystemFileHandle>;
  }
}
function Download() {
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [media, setMedia] = useState<MediaInfo>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mediaAllowed, setMediaAllowed] = useState(false),
    [status, setStatus] = useState(""),
    [progress, setProgress] = useState({ seconds: 0, bytes: 0 });
  const controller = useRef<AbortController | undefined>(undefined);
  const locked = useRef(false);
  async function refresh() {
    setError("");
    try {
      setSnapshot(await bridge.request<Snapshot>("snapshot").promise);
      setMedia(await bridge.request<MediaInfo>("media").promise);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not inspect this video.",
      );
    }
  }
  useEffect(() => {
    void refresh();
    void chrome.permissions
      .contains({ origins: ["https://*.googlevideo.com/*"] })
      .then(setMediaAllowed)
      .catch(() => {});
    document.documentElement.dataset.theme = matchMedia(
      "(prefers-color-scheme:dark)",
    ).matches
      ? "dark"
      : "light";
    const prevent = (e: BeforeUnloadEvent) => {
      if (locked.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => {
      controller.current?.abort();
      window.removeEventListener("beforeunload", prevent);
    };
  }, []);
  async function download(choice: DownloadChoice) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setProgress({ seconds: 0, bytes: 0 });
    controller.current = new AbortController();
    try {
      if (!window.showSaveFilePicker)
        throw new Error(
          "This browser does not support streaming downloads to a chosen file. Use current Chrome or Brave.",
        );
      if (!mediaAllowed)
        throw new Error("Enable video source access below first.");
      // The picker must run in this click's user activation, before network awaits.
      const handle = await window.showSaveFilePicker({
        suggestedName: `${safeFilename(snapshot?.video?.title || "Video")}.${choice.extension}`,
        types: [
          {
            description: choice.extension.toUpperCase() + " video",
            accept: { [`video/${choice.extension}`]: ["." + choice.extension] },
          },
        ],
      });
      checkAbort(controller.current.signal);
      const current = await bridge.request<MediaInfo>("media").promise;
      if (current.videoId !== media?.videoId)
        throw new Error(
          "The YouTube tab changed videos. Refresh available formats.",
        );
      const fresh = choices(current.formats).find(
        (c) =>
          c.video.itag === choice.video.itag &&
          c.audio?.itag === choice.audio?.itag,
      );
      if (!fresh)
        throw new Error(
          "This format is no longer exposed by the player. Refresh available formats.",
        );
      setStatus("Downloading and combining video + audio");
      let lastUpdate = 0;
      await remux(
        fresh,
        await handle.createWritable(),
        controller.current.signal,
        (seconds, bytes) => {
          if (performance.now() - lastUpdate > 200) {
            setProgress({ seconds, bytes });
            lastUpdate = performance.now();
          }
        },
      );
      setStatus("Saved successfully with video and audio.");
    } catch (e) {
      if (
        controller.current.signal.aborted ||
        (e instanceof DOMException && e.name === "AbortError")
      )
        setStatus("Download cancelled. Incomplete writes were discarded.");
      else {
        setStatus("");
        setError(
          "Download could not finish. " +
            (e instanceof Error ? e.message : "Source unavailable.") +
            " YouTube may restrict or expire direct media URLs.",
        );
      }
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  const available = media && !media.live ? choices(media.formats) : [];
  return (
    <main className="settings-shell download-page">
      <header className="settings-header">
        <span className="brand-mark">
          <Play size={18} fill="currentColor" />
        </span>
        <span className="eyebrow">TubeDeck / Download</span>
      </header>
      <h1>Keep the whole video.</h1>
      <p className="settings-intro">
        Choose an available source quality. Video and audio are combined in your
        browser, without re-encoding.
      </p>
      <section className="settings-card">
        {!mediaAllowed && (
          <div className="permission-note">
            <p>
              Allow TubeDeck to read video sources when you choose a download.
            </p>
            <button
              className="secondary"
              onClick={() => {
                void chrome.permissions
                  .request({ origins: ["https://*.googlevideo.com/*"] })
                  .then((granted) => {
                    setMediaAllowed(granted);
                    if (!granted) setError("Video source access was declined.");
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              Enable video source access
            </button>
          </div>
        )}
        <div className="section-heading">
          <div>
            <span className="eyebrow">Current video</span>
            <h2>{snapshot?.video?.title || "Connecting to YouTube…"}</h2>
          </div>
          <ArrowDownToLine size={25} />
        </div>
        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="banner" role="status">
            {busy && <LoaderCircle className="spin" size={16} />} {status}
          </p>
        )}
        {busy && (
          <div className="download-progress">
            <progress
              max={snapshot?.video?.duration || 1}
              value={progress.seconds}
            />
            <p>
              {timeLabel(progress.seconds)} processed ·{" "}
              {(progress.bytes / 1024 / 1024).toFixed(1)} MB written
            </p>
            <button
              className="secondary"
              onClick={() => {
                controller.current?.abort();
                setStatus("Stopping…");
              }}
            >
              <Square size={14} />
              Cancel download
            </button>
          </div>
        )}
        <div className="format-list">
          {available.map((c) => (
            <button
              className="format-row"
              disabled={busy || !mediaAllowed}
              key={c.video.itag}
              onClick={() => void download(c)}
            >
              <strong>{c.video.qualityLabel || `${c.video.height}p`}</strong>
              <span>
                {c.extension.toUpperCase()} · video + audio ·{" "}
                {c.video.mimeType.match(/codecs="([^"]+)"/)?.[1]}
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
        {media && !available.length && (
          <div className="empty">
            <h3>
              {media.live
                ? "Live streams are not supported"
                : "No downloadable source with audio is available"}
            </h3>
            <p>
              The current player did not expose a usable direct source. This
              build cannot unlock protected formats or decipher signatures.
            </p>
          </div>
        )}
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh available formats
        </button>
      </section>
      <p className="quiet">
        Up to the original 2160p source when exposed and accessible. Keep this
        tab open until saving finishes. Only download videos you have permission
        to save.
      </p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Download />);
