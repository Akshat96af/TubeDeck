import type { RpcEvent, Snapshot } from "../shared/types";
const preview = typeof chrome === "undefined" || !chrome.runtime?.id;
const fixture: Snapshot = {
  video: {
    id: "dQw4w9WgXcQ",
    title: "How good design makes everyday life better",
    channel: "Design Stories",
    duration: 1248,
    time: 194,
    dark: true,
    theatre: false,
  },
  active: false,
  settings: {
    model: "gemini-flash-latest",
    firebaseApiKey: "",
    googleClientId: "",
    rememberKey: false,
    hasKey: false,
  },
  messages: [],
  notes: [],
  sources: [],
  tokens: 0,
};
export const isPreview = preview;
export class Bridge {
  private port?: chrome.runtime.Port;
  private pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      delta?: (s: string) => void;
    }
  >();
  listeners = new Set<(event: string, data: any) => void>();
  constructor() {
    if (!preview) {
      this.connect();
      setInterval(() => {
        try {
          this.port?.postMessage({ id: "keepalive", action: "ping" });
        } catch {}
      }, 20000);
    }
  }
  private connect() {
    this.port = chrome.runtime.connect({ name: "companion" });
    this.port.onMessage.addListener((m: RpcEvent) => {
      if (m.event === "delta" && m.id) this.pending.get(m.id)?.delta?.(m.data);
      else if (m.event) this.listeners.forEach((cb) => cb(m.event!, m.data));
      else if (m.id) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        m.ok
          ? p.resolve(m.data)
          : p.reject(new Error(m.error || "Request failed."));
      }
    });
    this.port.onDisconnect.addListener(() => {
      this.pending.forEach((p) =>
        p.reject(
          new Error("Connection restarted. Reload this video to reconnect."),
        ),
      );
      this.pending.clear();
      this.port = undefined;
    });
  }
  request<T = any>(
    action: string,
    payload: unknown = {},
    delta?: (s: string) => void,
  ): { id: string; promise: Promise<T> } {
    const id = crypto.randomUUID();
    if (preview)
      return {
        id,
        promise: (action === "snapshot"
          ? Promise.resolve(fixture)
          : Promise.reject(
              new Error(
                "This is a visual preview. Load dist/ as an unpacked extension to use real features.",
              ),
            )) as Promise<T>,
      };
    const promise = new Promise<T>((resolve, reject) => {
      if (!this.port) {
        try {
          this.connect();
        } catch {
          reject(new Error("Reload the YouTube tab to reconnect."));
          return;
        }
      }
      this.pending.set(id, { resolve, reject, delta });
      try {
        this.port!.postMessage({ id, action, payload });
      } catch {
        this.pending.delete(id);
        reject(new Error("The extension disconnected. Reload this video."));
      }
    });
    return { id, promise };
  }
  cancel(id: string) {
    this.port?.postMessage({
      id: crypto.randomUUID(),
      action: "cancel",
      payload: { id },
    });
  }
}
export const bridge = new Bridge();
