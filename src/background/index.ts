import { readMedia } from "./media";
import { readCaptions } from "./captions";
import type {
  AIRequest,
  CommentSet,
  Message,
  Note,
  RpcMessage,
  Snapshot,
  Source,
  Transcript,
  Video,
  MediaInfo,
  ResearchResult,
} from "../shared/types";
import { generate, listModels } from "./gemini";
import {
  clearKey,
  deleteNote,
  getSettings,
  getGeminiKey,
  notesFor,
  saveNote,
  setSettings,
} from "./storage";
import { requireUser, signIn, signOut, user } from "./auth";
import { parseTranscript, safeSources, checkAbort } from "../shared/utils";
import { validatedSponsors } from "../shared/evidence";
import { z } from "zod";

const settingsSchema = z.object({
  model: z
    .string()
    .regex(/^[\w.-]+$/)
    .max(100),
  firebaseApiKey: z.string().max(200),
  googleClientId: z.string().max(300),
  rememberKey: z.boolean(),
});
const noteSchema = z.object({
  id: z.string().max(100),
  videoId: z.string().regex(/^[\w-]{11}$/),
  videoTitle: z.string().max(1000),
  time: z.number().min(0).nullable(),
  title: z.string().max(500),
  body: z.string().max(200000),
  image: z
    .string()
    .max(8000000)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
  sources: z
    .array(
      z.object({ title: z.string().max(500), url: z.string().url().max(4000) }),
    )
    .max(100)
    .optional(),
  createdAt: z.number(),
  kind: z.enum(["note", "screenshot", "bookmark", "quiz", "flashcards"]),
});
interface Session {
  video: Video;
  active: boolean;
  transcript?: Transcript;
  comments?: CommentSet;
  messages: Message[];
  research: ResearchResult[];
  sources: Source[];
  tokens: number;
}
const sessions = new Map<number, Session>();
const ports = new Set<chrome.runtime.Port>();
const jobs = new Map<
  string,
  {
    controller: AbortController;
    tabId?: number;
    ai?: boolean;
    videoId?: string;
  }
>();
const origin = chrome.runtime.getURL("");
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const send = (port: chrome.runtime.Port, m: unknown) => {
  try {
    port.postMessage(m);
  } catch {}
};
const broadcast = (event: string, data: unknown, tabId?: number) => {
  ports.forEach((p) => {
    if (tabId === undefined || p.sender?.tab?.id === tabId)
      send(p, { event, data });
  });
};
function reset(tabId: number, video?: Video) {
  for (const job of jobs.values())
    if (job.tabId === tabId) job.controller.abort();
  sessions.delete(tabId);
  if (video)
    sessions.set(tabId, {
      video,
      active: false,
      messages: [],
      research: [],
      sources: [],
      tokens: 0,
    });
  broadcast("reset", video, tabId);
}
async function page(
  tabId: number,
  command: string,
  payload: unknown = {},
  id: string = crypto.randomUUID(),
  videoId?: string,
): Promise<any> {
  const result = await chrome.tabs.sendMessage(
    tabId,
    { type: "page", command, payload, id, videoId },
    { frameId: 0 },
  );
  if (!result?.ok)
    throw new Error(
      result?.error || "Could not reach the video. Reload the YouTube tab.",
    );
  return result.data;
}
async function sessionFor(tabId: number): Promise<Session> {
  const video = (await page(tabId, "context")) as Video;
  if (!video.id) throw new Error("Open a YouTube video first.");
  if (!sessions.has(tabId))
    sessions.set(tabId, {
      video,
      active: false,
      messages: [],
      research: [],
      sources: [],
      tokens: 0,
    });
  else if (sessions.get(tabId)!.video.id !== video.id) reset(tabId, video);
  const s = sessions.get(tabId)!;
  s.video = video;
  return s;
}
async function snapshot(tabId?: number): Promise<Snapshot> {
  const s = tabId !== undefined ? await sessionFor(tabId) : undefined;
  return {
    video: s?.video,
    active: s?.active ?? false,
    user: await user(),
    settings: await getSettings(),
    transcript: s?.transcript,
    comments: s?.comments,
    messages: s?.messages ?? [],
    research: s?.research ?? [],
    notes: s ? await notesFor(s.video.id) : [],
    sources: s?.sources ?? [],
    tokens: s?.tokens ?? 0,
  };
}
function requireActive(s: Session) {
  if (!s.active) throw new Error("Activate AI for this video first.");
}
async function disconnectIdentity() {
  await signOut();
  for (const id of [...sessions.keys()]) {
    reset(id);
    await page(id, "activation", { active: false }).catch(() => {});
  }
  broadcast("auth", null);
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "companion" || !port.sender?.url?.startsWith(origin))
    return;
  const pathname = new URL(port.sender.url).pathname;
  const settingsPage = pathname === "/settings.html";
  const downloadPage = pathname === "/download.html";
  if (!["/settings.html", "/panel.html", "/download.html"].includes(pathname))
    return;
  ports.add(port);
  const owned = new Set<string>();
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    for (const id of owned) jobs.get(id)?.controller.abort();
  });
  port.onMessage.addListener(async (m: RpcMessage) => {
    if (!m || typeof m.id !== "string" || typeof m.action !== "string") return;
    if (m.action === "ping") return;
    if (m.action === "cancel") {
      const id = m.payload?.id;
      if (owned.has(id)) {
        jobs.get(id)?.controller.abort();
        const t = jobs.get(id)?.tabId;
        if (t !== undefined) void page(t, "cancel", { id }).catch(() => {});
      }
      return;
    }
    const controller = new AbortController();
    owned.add(m.id);
    let tabId = port.sender?.tab?.id;
    if (downloadPage)
      tabId = Number(new URL(port.sender!.url!).searchParams.get("tab"));
    jobs.set(m.id, { controller, tabId });
    controller.signal.addEventListener(
      "abort",
      () => {
        if (tabId !== undefined)
          void page(tabId, "cancel", { id: m.id }).catch(() => {});
      },
      { once: true },
    );
    try {
      const p = m.payload ?? {};
      let data: unknown;
      if (m.action === "snapshot")
        data = await snapshot(settingsPage ? undefined : tabId);
      else if (m.action === "settings-save" && settingsPage) {
        const previous = await getSettings(),
          next = {
            ...settingsSchema.parse(p.settings),
            firebaseApiKey: previous.firebaseApiKey,
            googleClientId: previous.googleClientId,
          };
        await setSettings(next, p.key);
        data = await getSettings();
        broadcast("settings-changed", data);
      } else if (m.action === "key-clear" && settingsPage) {
        await clearKey();
        for (const job of jobs.values()) if (job.ai) job.controller.abort();
        for (const [id, s] of sessions) {
          s.active = false;
          void page(id, "activation", { active: false }).catch(() => {});
        }
        broadcast("settings-changed", await getSettings());
        broadcast("activation-off", {});
        data = true;
      } else if (m.action === "models" && settingsPage)
        data = await listModels(controller.signal);
      else if (m.action === "sign-in" && settingsPage) {
        data = await signIn();
        broadcast("auth", data);
      } else if (m.action === "sign-out" && settingsPage) {
        await disconnectIdentity();
        data = true;
      } else if (m.action === "settings-open") {
        await chrome.runtime.openOptionsPage();
        data = true;
      } else if (tabId === undefined || !Number.isInteger(tabId))
        throw new Error("No YouTube tab is connected.");
      else if (m.action === "media" && downloadPage)
        data = await readMedia(tabId);
      else if (m.action === "download-open") {
        await chrome.tabs.create({
          url: chrome.runtime.getURL(`download.html?tab=${tabId}`),
        });
        data = true;
      } else {
        const s = await sessionFor(tabId);
        checkAbort(controller.signal);
        if (p.videoId && p.videoId !== s.video.id)
          throw new Error(
            "The video changed. Activate the current video to continue.",
          );
        jobs.get(m.id)!.videoId = s.video.id;
        const current = () => {
          checkAbort(controller.signal);
          if (sessions.get(tabId!) !== s) throw new Error("The video changed.");
        };
        if (m.action === "activate") {
          await requireUser();
          await getGeminiKey();
          current();
          s.active = true;
          await page(tabId, "activation", { active: true }, m.id, s.video.id);
          data = await snapshot(tabId);
        } else if (m.action === "deactivate") {
          s.active = false;
          for (const [id, job] of jobs)
            if (id !== m.id && job.tabId === tabId) {
              job.controller.abort();
              void page(tabId, "cancel", { id }).catch(() => {});
            }
          await page(tabId, "activation", { active: false });
          data = true;
        } else if (m.action === "transcript") {
          requireActive(s);
          if (s.transcript?.segments.length && !p.reload) data = s.transcript;
          else {
            let transcript: Transcript;
            try {
              transcript = await readCaptions(
                tabId,
                s.video.id,
                controller.signal,
              );
            } catch {
              current();
              transcript = await page(
                tabId,
                "transcript",
                {},
                m.id,
                s.video.id,
              );
            }
            current();
            s.transcript = transcript;
            data = s.transcript;
          }
        } else if (m.action === "transcript-paste") {
          if (typeof p.text !== "string" || p.text.length > 1600000)
            throw new Error("Transcript is too large.");
          s.transcript = parseTranscript(p.text);
          data = s.transcript;
        } else if (m.action === "comments") {
          s.comments = await page(tabId, "comments", {}, m.id, s.video.id);
          data = s.comments;
        } else if (m.action === "page") {
          const allowed = [
            "context",
            "seek",
            "capture",
            "capture-at",
            "speed",
            "loop",
            "focus",
            "sponsors",
            "caption-tip",
          ];
          if (!allowed.includes(p.command))
            throw new Error("Unknown player action.");
          if (p.command === "sponsors") {
            requireActive(s);
            p.args = {
              segments: validatedSponsors(
                p.args?.segments ?? [],
                s.video.duration,
                s.transcript,
              ),
            };
          }
          data = await page(tabId, p.command, p.args, m.id, s.video.id);
        } else if (m.action === "note-save") {
          const note = noteSchema.parse(p.note);
          if (note.videoId !== s.video.id)
            throw new Error("Note belongs to a different video.");
          note.sources = safeSources(note.sources ?? []);
          await saveNote(note);
          data = await notesFor(s.video.id);
        } else if (m.action === "note-delete") {
          const notes = await notesFor(s.video.id);
          if (notes.some((n) => n.id === p.id)) await deleteNote(p.id);
          data = await notesFor(s.video.id);
        } else if (m.action === "chat-clear") {
          s.messages = [];
          data = true;
        } else if (m.action === "ai") {
          requireActive(s);
          await requireUser();
          current();
          const kind = z
            .enum([
              "recommend",
              "chat",
              "summary",
              "explain",
              "check",
              "comments",
              "comment-question",
              "capture-plan",
              "visual-note",
              "objects",
              "product",
              "sponsors",
              "quiz",
              "flashcards",
            ])
            .parse(p.kind);
          if (
            [...jobs.entries()].some(
              ([id, j]) => id !== m.id && j.tabId === tabId && j.ai,
            )
          )
            throw new Error(
              "An AI task is already running. Stop it or wait for it to finish.",
            );
          jobs.get(m.id)!.ai = true;
          const t = s.transcript ?? {
            segments: [],
            source: "youtube",
            complete: false,
            detail: "No transcript available; title only.",
          };
          if (
            !t.segments.length &&
            ![
              "recommend",
              "objects",
              "product",
              "explain",
              "comments",
              "comment-question",
            ].includes(kind)
          )
            throw new Error("Load or paste a transcript first.");
          const request: AIRequest = {
            kind,
            video: s.video,
            transcript: t,
            question:
              typeof p.question === "string" ? p.question.slice(0, 20000) : "",
            selection:
              typeof p.selection === "string"
                ? p.selection.slice(0, 20000)
                : "",
            image: p.image,
            history: kind === "chat" ? s.messages : undefined,
            comments: ["comments", "comment-question"].includes(kind)
              ? s.comments
              : undefined,
          };
          if (
            ["comments", "comment-question"].includes(kind) &&
            !request.comments?.items.length
          )
            throw new Error("Load some comments first.");
          let partial = "";
          try {
            const result = await generate(
              request,
              controller.signal,
              (text) => {
                partial += text;
                send(port, { event: "delta", id: m.id, data: text });
              },
              (text) =>
                send(port, { event: "progress", data: { id: m.id, text } }),
            );
            current();
            if (
              kind === "product" &&
              (!/^\s*(?:\*\*)?Exact product identified\b/i.test(result.text) ||
                !result.searchUsed ||
                !result.sources.length)
            ) {
              result.sources = [];
              result.text = result.text
                .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, "$1")
                .replace(/https?:\/\/[^\s<>\])]+/g, "[link withheld]");
            }
            if (request.comments) {
              result.sources = safeSources([
                ...result.sources,
                ...request.comments.items
                  .filter((c) => result.text.includes(`[comment:${c.id}]`))
                  .map((c) => ({
                    title: `Comment by ${c.author}`,
                    url: c.url,
                  })),
              ]);
            }
            data = result;
            s.tokens += result.tokens;
            s.sources = safeSources([...s.sources, ...result.sources]);
            if (
              ![
                "chat",
                "recommend",
                "capture-plan",
                "objects",
                "sponsors",
              ].includes(kind)
            )
              s.research.push({
                kind,
                selection: request.selection,
                text: result.text,
                sources: result.sources,
                searchUsed: result.searchUsed,
                createdAt: Date.now(),
              });
            if (kind === "chat")
              s.messages.push(
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  text: request.question!,
                },
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  text: result.text,
                  sources: result.sources,
                },
              );
          } catch (e) {
            if (kind === "chat" && partial)
              s.messages.push(
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  text: request.question!,
                },
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  text: partial,
                  incomplete: true,
                },
              );
            throw e;
          }
        } else throw new Error("Unsupported action.");
      }
      send(port, { id: m.id, ok: true, data });
    } catch (error) {
      send(port, {
        id: m.id,
        ok: false,
        error: controller.signal.aborted
          ? "Stopped"
          : error instanceof Error
            ? error.message
            : "Something went wrong.",
      });
    } finally {
      owned.delete(m.id);
      jobs.delete(m.id);
    }
  });
});
chrome.runtime.onMessage.addListener((m, sender) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab?.id === undefined ||
    sender.frameId !== 0 ||
    !sender.url?.startsWith("https://www.youtube.com/")
  )
    return;
  const tabId = sender.tab.id;
  if (m.event === "video-changed") reset(tabId, m.data ?? undefined);
  if (m.event === "context") {
    const s = sessions.get(tabId);
    if (s && s.video.id === m.data?.id) s.video = m.data;
    broadcast("context", m.data, tabId);
  }
  if (m.event === "page-progress") {
    const s = sessions.get(tabId),
      job = jobs.get(m.data?.id);
    if (
      !s ||
      !job ||
      job.videoId !== s.video.id ||
      job.controller.signal.aborted
    )
      return;
    if (m.data?.comments) s.comments = m.data.comments;
    broadcast("progress", m.data, tabId);
  }
  if (m.event === "caption-hover" && sessions.get(tabId)?.active)
    broadcast("caption-hover", m.data, tabId);
  if (m.event === "caption-action" && sessions.get(tabId)?.active)
    broadcast("caption-action", m.data, tabId);
  if (m.event === "caption-stop") broadcast("caption-stop", {}, tabId);
  if (m.event === "skipped") broadcast("skipped", m.data, tabId);
});
chrome.tabs.onRemoved.addListener((id) => reset(id));
chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});
