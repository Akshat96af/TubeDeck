import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  Layers3,
  ListVideo,
  LoaderCircle,
  MessageCircle,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  SkipForward,
  Sparkles,
  Square,
  Trash2,
  X,
  Bookmark,
  Repeat2,
  Focus,
  Send,
  ChevronLeft,
  Save,
  PackageOpen,
} from "lucide-react";
import type {
  AIKind,
  AIResult,
  CommentSet,
  DetectedObject,
  Note,
  Snapshot,
  Sponsor,
  Transcript,
  Video,
} from "../shared/types";
import { parseJson, timeLabel } from "../shared/utils";
import { Dialog } from "./Dialog";
import { bridge, isPreview } from "./rpc";
import { Markdown, Sources, SearchSuggestions } from "./Markdown";
import { capsule, capsuleZip, saveBlob } from "../shared/capsule";
import { z } from "zod";
import { PanelNavigation, panelItems, type PanelTask } from "./PanelNavigation";

const initial: Snapshot = {
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
type Tab = PanelTask;
interface Result {
  title: string;
  text: string;
  sources: AIResult["sources"];
  searchUsed?: boolean;
  searchSuggestions?: string;
  productSearch?: string;
}
const quizSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).length(4),
        answer: z.number().int().min(0).max(3),
        explanation: z.string(),
        time: z.number().nullable(),
      }),
    )
    .max(20),
});
const cardsSchema = z.object({
  cards: z
    .array(
      z.object({
        front: z.string(),
        back: z.string(),
        time: z.number().nullable(),
      }),
    )
    .max(30),
});
export function App() {
  const [state, setState] = useState(initial),
    [tab, setTab] = useState<Tab>("chat"),
    [collapsed, setCollapsed] = useState(false);
  const shellRef = useRef<HTMLElement>(null);
  function closePanel() {
    setCollapsed(true);
    setHoverOpen(false);
    clearTimeout(hoverTimer.current);
    document.getElementById(`panel-${tab}`)?.focus();
  }
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const resize = () =>
      parent.postMessage(
        {
          type: "yc-resize",
          height: Math.ceil(shell.getBoundingClientRect().height),
        },
        "https://www.youtube.com",
      );
    const observer = new ResizeObserver(resize);
    observer.observe(shell);
    resize();
    return () => observer.disconnect();
  }, []);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [question, setQuestion] = useState(""),
    [stream, setStream] = useState(""),
    [result, setResult] = useState<Result | null>(null);
  const [paste, setPaste] = useState(false),
    [pasteText, setPasteText] = useState(""),
    [find, setFind] = useState(""),
    [commentQuery, setCommentQuery] = useState(""),
    [commentSummary, setCommentSummary] = useState<Result | null>(null);
  const [recommended, setRecommended] = useState<string[]>([]),
    [productsSuggested, setProductsSuggested] = useState(false),
    [objects, setObjects] = useState<DetectedObject[]>([]),
    [productImage, setProductImage] = useState("");
  const [noteText, setNoteText] = useState(""),
    [capsuleOpen, setCapsuleOpen] = useState(false),
    [sponsorOn, setSponsorOn] = useState(false),
    [sponsorSegments, setSponsorSegments] = useState<Sponsor[]>([]);
  const [quiz, setQuiz] = useState<z.infer<typeof quizSchema> | null>(null),
    [answers, setAnswers] = useState<Record<number, number>>({}),
    [cards, setCards] = useState<z.infer<typeof cardsSchema> | null>(null),
    [cardIndex, setCardIndex] = useState(0),
    [flipped, setFlipped] = useState(false);
  const [loopA, setLoopA] = useState<number | null>(null),
    [loopB, setLoopB] = useState<number | null>(null),
    [focusComments, setFocusComments] = useState(false),
    [focusRecommendations, setFocusRecommendations] = useState(false);
  const [hover, setHover] = useState<{
    text: string;
    time?: number;
    context?: string;
  } | null>(null);
  const [hoverResult, setHoverResult] = useState<AIResult | null>(null),
    [hoverOpen, setHoverOpen] = useState(false);
  const hoverCache = useRef(new Map<string, AIResult>());
  const pending = useRef(""),
    stopped = useRef(false),
    running = useRef(false),
    epoch = useRef(0),
    stateRef = useRef(state),
    hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    scrollRef = useRef<HTMLDivElement>(null);
  stateRef.current = state;
  async function rpc<T = any>(
    action: string,
    payload: Record<string, unknown> = {},
    delta?: (s: string) => void,
  ): Promise<T> {
    if (stopped.current) throw new Error("Stopped");
    const e = epoch.current;
    const request = bridge.request<T>(
      action,
      { ...payload, videoId: stateRef.current.video?.id },
      (s) => {
        if (e === epoch.current) delta?.(s);
      },
    );
    pending.current = request.id;
    const response = await request.promise;
    if (e !== epoch.current) throw new Error("The video changed.");
    return response;
  }
  async function refresh() {
    const e = epoch.current;
    const data = await bridge.request<Snapshot>("snapshot").promise;
    if (e === epoch.current) setState(data);
  }
  function stop() {
    if (!running.current) return;
    stopped.current = true;
    if (pending.current) bridge.cancel(pending.current);
    setBusy("Stopping…");
  }
  async function run(label: string, fn: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    stopped.current = false;
    const e = epoch.current;
    setBusy(label);
    setError("");
    setNotice("");
    setStream("");
    try {
      await fn();
    } catch (ex) {
      if (epoch.current === e) {
        const message =
          ex instanceof Error ? ex.message : "Something went wrong.";
        if (message === "Stopped")
          setNotice("Stopped. Completed results have been kept.");
        else setError(message);
      }
    } finally {
      if (epoch.current === e) {
        running.current = false;
        setBusy("");
        pending.current = "";
        void refresh().catch(() => {});
      }
    }
  }
  const page = (command: string, args: unknown = {}) =>
    rpc("page", { command, args });
  const seek = (time: number) => {
    void bridge
      .request("page", { command: "seek", args: { time } })
      .promise.catch((e) => setError(e.message));
  };
  async function ai(
    kind: AIKind,
    extra: Record<string, unknown> = {},
  ): Promise<AIResult> {
    setStream("");
    let text = "";
    const response = await rpc<AIResult>("ai", { kind, ...extra }, (delta) => {
      text += delta;
      setStream(text);
    });
    if (stopped.current) throw new Error("Stopped");
    return response;
  }
  function show(title: string, r: AIResult) {
    setResult({ title, ...r });
    setStream("");
  }
  async function addNote(data: Partial<Note>) {
    const s = stateRef.current;
    if (!s.video) return;
    const note: Note = {
      id: crypto.randomUUID(),
      videoId: s.video.id,
      videoTitle: s.video.title,
      time: data.time ?? null,
      title: data.title || "Note",
      body: data.body || "",
      createdAt: Date.now(),
      kind: "note",
      ...data,
    };
    const notes = await rpc<Note[]>("note-save", { note });
    setState((s) => ({ ...s, notes }));
    return note;
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const listener = (event: string, data: any) => {
      if (event === "context") setState((s) => ({ ...s, video: data }));
      if (event === "auth") void refresh().catch(() => {});
      if (event === "settings-changed")
        setState((s) => ({ ...s, settings: data }));
      if (event === "activation-off") {
        setState((s) => ({ ...s, active: false }));
        setSponsorOn(false);
        setHoverOpen(false);
      }
      if (event === "caption-stop" && running.current) stop();
      if (event === "reset") {
        epoch.current++;
        stopped.current = true;
        if (pending.current) bridge.cancel(pending.current);
        pending.current = "";
        running.current = false;
        clearTimeout(hoverTimer.current);
        hoverCache.current.clear();
        setHoverResult(null);
        setHoverOpen(false);
        setBusy("");
        setStream("");
        setResult(null);
        setRecommended([]);
        setProductsSuggested(false);
        setObjects([]);
        setProductImage("");
        setPaste(false);
        setPasteText("");
        setCommentSummary(null);
        setSponsorOn(false);
        setSponsorSegments([]);
        setQuiz(null);
        setCards(null);
        setHover(null);
        setQuestion("");
        setFind("");
        setCommentQuery("");
        setLoopA(null);
        setLoopB(null);
        setFocusComments(false);
        setFocusRecommendations(false);
        setNoteText("");
        setCapsuleOpen(false);
        setCollapsed(false);
        setTab("chat");
        setError("");
        setNotice("");
        setState((s) => ({
          ...initial,
          user: s.user,
          settings: s.settings,
          video: data ?? undefined,
        }));
        void refresh().catch(() => {});
      }
      if (event === "progress" && data.id === pending.current) {
        setBusy(data.text);
        if (data.comments) setState((s) => ({ ...s, comments: data.comments }));
      }
      if (event === "caption-hover") {
        if (!running.current && stateRef.current.active) {
          setHover(data);
          void explain(data.text, false, data.context, true);
        }
      }
      if (event === "caption-action" && !running.current) {
        setCollapsed(false);
        setHover(data);
        if (data.action === "check")
          void run("Checking this claim", async () => {
            const r = await ai("check", {
              selection: data.context
                ? `Selected text: ${data.text}\nSurrounding line: ${data.context}`
                : data.text,
            });
            show("Evidence check", r);
            setTab("chat");
          });
        else void explain(data.text, true, data.context, true);
      }
      if (event === "skipped")
        setNotice(
          `Skipped paid sponsorship · ${timeLabel(data.start)}–${timeLabel(data.end)}`,
        );
    };
    bridge.listeners.add(listener);
    return () => {
      bridge.listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.video?.dark
      ? "dark"
      : "light";
  }, [state.video?.dark]);
  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [stream, state.messages.length]);
  async function activate() {
    setTab("chat");
    setCollapsed(false);
    await run("Preparing this video", async () => {
      const videoEpoch = epoch.current;
      const snap = await rpc<Snapshot>("activate");
      setState(snap);
      let transcript: Transcript | undefined;
      try {
        transcript = await rpc("transcript");
        setState((s) => ({ ...s, transcript }));
      } catch (e) {
        if (stopped.current || videoEpoch !== epoch.current) throw e;
        setNotice(e instanceof Error ? e.message : "Transcript unavailable.");
      }
      setBusy("Finding useful starting points");
      const r = await ai("recommend");
      const parsed = z
        .object({
          actions: z.array(z.string()).max(5),
          productsMentioned: z.boolean(),
        })
        .parse(parseJson(r.text));
      setRecommended(parsed.actions);
      setProductsSuggested(
        parsed.productsMentioned && Boolean(transcript?.segments.length),
      );
      setStream("");
    });
  }
  async function explain(
    text: string,
    deep: boolean,
    context?: string,
    caption = false,
  ) {
    const key = `${stateRef.current.video?.id}:${text}:${context || ""}`;
    const deliver = (r: AIResult) => {
      if (deep) {
        show("A closer look", r);
        setTab("chat");
      } else {
        setHoverResult(r);
        setHoverOpen(!caption);
        setStream("");
      }
      if (caption)
        void bridge
          .request("page", {
            command: "caption-tip",
            args: {
              text: r.text,
              selection: text,
              context,
              sources: r.sources,
              searchSuggestions: r.searchSuggestions,
              loading: false,
            },
          })
          .promise.catch(() => {});
    };
    if (!deep && hoverCache.current.has(key)) {
      deliver(hoverCache.current.get(key)!);
      return;
    }
    if (!deep) {
      setHoverResult(null);
      setHoverOpen(!caption);
    }
    if (caption)
      void bridge
        .request("page", {
          command: "caption-tip",
          args: {
            text: "Looking up this reference…",
            selection: text,
            context,
            loading: true,
          },
        })
        .promise.catch(() => {});
    await run(
      deep ? "Explaining in context" : "Understanding this reference",
      async () => {
        try {
          const r = await ai("explain", {
            selection: context
              ? `Selected text: ${text}\nSurrounding line: ${context}`
              : text,
            question: deep
              ? "DEEP: Explain this fully with context and evidence."
              : "BRIEF: Explain in 1–3 simple sentences.",
          });
          if (!deep && !r.searchUsed) hoverCache.current.set(key, r);
          deliver(r);
        } catch (e) {
          if (caption)
            void bridge
              .request("page", {
                command: "caption-tip",
                args: {
                  dismiss: e instanceof Error && e.message === "Stopped",
                  text:
                    e instanceof Error
                      ? e.message
                      : "Could not explain this reference.",
                  selection: text,
                  context,
                  loading: false,
                },
              })
              .promise.catch(() => {});
          throw e;
        }
      },
    );
  }
  function hoverText(text: string, time?: number, context?: string) {
    if (!stateRef.current.active || running.current) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      if (!stateRef.current.active || running.current) return;
      setHover({ text, time, context });
      void explain(text, false, context);
    }, 900);
  }
  async function sendQuestion(text = question) {
    if (!text.trim() || running.current || !stateRef.current.active) return;
    setQuestion("");
    setResult(null);
    await run("Thinking about the video", async () => {
      await ai("chat", { question: text });
      setStream("");
      await refresh();
    });
  }
  async function analyze(kind: AIKind, title: string) {
    await run(title, async () => {
      const r = await ai(kind);
      show(title, r);
      if (kind === "summary")
        await addNote({
          title: "Video summary",
          body: r.text,
          sources: r.sources,
        });
    });
  }
  async function loadDiscussion() {
    await run("Loading top-level comments", async () => {
      const comments = await rpc<CommentSet>("comments");
      setState((s) => ({ ...s, comments }));
      if (stopped.current) throw new Error("Stopped");
      if (!comments.items.length) return;
      if (!stateRef.current.active) {
        setNotice("Comments loaded. Activate AI to summarize the discussion.");
        return;
      }
      setBusy("Summarizing viewer thoughts");
      const r = await ai("comments");
      setCommentSummary({ title: "What viewers think", ...r });
      setStream("");
      await addNote({
        title: "Viewer thoughts",
        body: `${comments.detail}\n\n${r.text}`,
        sources: r.sources,
      });
    });
  }
  async function visualNotes() {
    await run("Selecting useful visual moments", async () => {
      const r = await ai("capture-plan");
      const plan = z
        .object({
          moments: z
            .array(z.object({ time: z.number().min(0), reason: z.string() }))
            .max(4),
        })
        .parse(parseJson(r.text));
      let saved = 0;
      for (const moment of plan.moments) {
        if (stopped.current) throw new Error("Stopped");
        if (moment.time > (stateRef.current.video?.duration ?? 0)) continue;
        setBusy(`Capturing ${timeLabel(moment.time)} · ${saved} saved`);
        const frame = await page("capture-at", { time: moment.time });
        const response = await ai("visual-note", {
          image: frame.image,
          selection: moment.reason,
          question: `Frame captured at ${timeLabel(frame.time)}`,
        });
        const note = z
          .object({
            relevant: z.boolean(),
            title: z.string(),
            explanation: z.string(),
          })
          .parse(parseJson(response.text));
        if (note.relevant) {
          await addNote({
            title: note.title,
            body: note.explanation,
            time: frame.time,
            image: frame.image,
            kind: "screenshot",
          });
          saved++;
        }
      }
      setStream("");
      setTab("notes");
      setNotice(`${saved} relevant visual notes saved. Playback restored.`);
    });
  }
  async function listProducts() {
    await run("Looking at this frame", async () => {
      const frame = await page("capture");
      setProductImage(frame.image);
      const r = await ai("objects", {
        image: frame.image,
        question: `Frame at ${timeLabel(frame.time)}`,
      });
      const parsed = z
        .object({
          objects: z
            .array(z.object({ name: z.string(), description: z.string() }))
            .max(8),
        })
        .parse(parseJson(r.text));
      setObjects(parsed.objects);
      setStream("");
      setTab("tools");
    });
  }
  async function product(obj: DetectedObject) {
    await run("Researching the selected product", async () => {
      const r = await ai("product", {
        image: productImage,
        selection: `${obj.name}: ${obj.description}`,
      });
      // Search redirect URLs can hide their retail destination. No source link is
      // exposed as a purchase route unless the result establishes an exact match.
      if (
        !/^\s*(?:\*\*)?Exact product identified\b/i.test(r.text) ||
        !r.sources.length
      )
        r.sources = [];
      setResult({
        title: obj.name,
        ...r,
        productSearch: obj.name + " " + obj.description,
      });
      setStream("");
      setTab("chat");
    });
  }
  async function toggleSponsors() {
    if (sponsorOn) {
      await run("Turning sponsor skipping off", async () => {
        await page("sponsors", { segments: [] });
        setSponsorOn(false);
      });
      return;
    }
    await run("Finding paid sponsorships", async () => {
      const r = await ai("sponsors");
      const parsed = z
        .object({
          segments: z.array(
            z.object({
              start: z.number(),
              end: z.number(),
              confidence: z.enum(["clear", "uncertain"]),
              reason: z.string(),
            }),
          ),
        })
        .parse(parseJson(r.text));
      const accepted = (await page("sponsors", {
        segments: parsed.segments,
      })) as Sponsor[];
      setSponsorSegments(accepted);
      setSponsorOn(true);
      setStream("");
      setNotice(
        `${accepted.filter((s) => s.confidence === "clear").length} automatic skips · ${accepted.filter((s) => s.confidence === "uncertain").length} manual suggestions.`,
      );
    });
  }
  async function study(kind: "quiz" | "flashcards") {
    await run(
      kind === "quiz" ? "Making a quiz" : "Creating flashcards",
      async () => {
        const r = await ai(kind);
        if (kind === "quiz") {
          setQuiz(quizSchema.parse(parseJson(r.text)));
          setAnswers({});
        } else {
          setCards(cardsSchema.parse(parseJson(r.text)));
          setCardIndex(0);
          setFlipped(false);
        }
        await addNote({
          title: kind === "quiz" ? "Video quiz" : "Flashcards",
          body: r.text,
          kind,
        });
        setStream("");
      },
    );
  }
  async function exportCapsule(mode: "copy" | "compact" | "zip") {
    try {
      const fresh = await bridge.request<Snapshot>("snapshot").promise;
      if (mode === "zip")
        saveBlob(
          new Blob([capsuleZip(fresh) as BlobPart], {
            type: "application/zip",
          }),
          `${fresh.video?.title || "Video"} context.zip`,
        );
      else await navigator.clipboard.writeText(capsule(fresh, mode === "copy"));
      setNotice(
        mode === "zip"
          ? "Capsule downloaded with saved images."
          : "Context copied. Paste it into another AI.",
      );
      setCapsuleOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export capsule.");
    }
  }
  const disabled = !state.active || Boolean(busy);
  const filteredSegments =
    state.transcript?.segments.filter((s) =>
      s.text.toLowerCase().includes(find.toLowerCase()),
    ) ?? [];
  const filteredComments =
    state.comments?.items.filter((c) =>
      `${c.text} ${c.author}`
        .toLowerCase()
        .includes(commentQuery.toLowerCase()),
    ) ?? [];
  const video = state.video;
  return (
    <main
      ref={shellRef}
      className={`companion panel-shell ${collapsed ? "collapsed" : ""}`}
    >
      <PanelNavigation
        task={tab}
        expanded={!collapsed}
        active={state.active}
        busy={busy}
        notes={state.notes.length}
        onSelect={(next) => {
          {
            setTab(next);
            setCollapsed(false);
            setHoverOpen(false);
            clearTimeout(hoverTimer.current);
          }
        }}
        onActivate={() => void activate()}
        onPause={() => {
          clearTimeout(hoverTimer.current);
          setHoverOpen(false);
          if (running.current) stop();
          void bridge
            .request("deactivate")
            .promise.then(() => refresh())
            .catch((e) => setError(e.message));
        }}
        onStop={stop}
        onSettings={() =>
          void bridge
            .request("settings-open")
            .promise.catch((e) => setError(e.message))
        }
      />
      <div
        className="task-panel"
        hidden={collapsed}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !hoverOpen && !capsuleOpen) {
            event.preventDefault();
            closePanel();
          }
        }}
      >
        <header className="task-panel-header">
          <h2>{panelItems.find((item) => item.id === tab)?.label}</h2>
          <span className="task-panel-context">
            {video?.title || "Your video, a little more useful."}
          </span>
          <button
            className="icon-button"
            title="Close panel"
            aria-label="Close task panel"
            onClick={closePanel}
          >
            <X size={18} />
          </button>
        </header>
        {isPreview && (
          <div className="preview-label">
            Visual preview · fixture video · real AI features require the
            installed extension
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            <CircleHelp size={15} />
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {notice && (
          <div className="banner" role="status">
            <Check size={15} />
            <span>{notice}</span>
            <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className="workspace">
          <div
            className="chat-layout panel-task"
            id="task-chat"
            role="region"
            aria-labelledby="panel-chat"
            hidden={tab !== "chat"}
          >
            <section className="conversation">
              {state.messages.length > 0 && (
                <div className="conversation-actions">
                  <button
                    className="text-button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("Clearing conversation", async () => {
                        await rpc("chat-clear");
                        setState((s) => ({ ...s, messages: [] }));
                        setResult(null);
                        setStream("");
                      })
                    }
                  >
                    <Trash2 size={13} />
                    Clear conversation
                  </button>
                </div>
              )}
              <div className="conversation-scroll" ref={scrollRef}>
                {state.messages.length === 0 && !result && !busy && (
                  <div className="welcome">
                    <span className="eyebrow">
                      <span className="tiny-line" /> A little more from every
                      video
                    </span>
                    <h1>
                      Watch. Wonder.
                      <br />
                      <span>Go a little deeper.</span>
                    </h1>
                    <p>
                      Ask about a moment, unpack a reference, or keep an idea.
                      <br className="wide-only" /> Your video is the starting
                      point.
                    </p>
                    {!state.active && (
                      <button
                        className="primary activate"
                        onClick={() => void activate()}
                      >
                        <Sparkles size={16} />
                        Activate for this video
                        <ArrowUpRight size={16} />
                      </button>
                    )}
                    {!state.active && (
                      <span className="quiet">
                        {state.user && state.settings.hasKey
                          ? "Uses your Gemini key. You can stop at any time."
                          : "Sign in and connect your Gemini key in settings."}
                      </span>
                    )}
                    {recommended.length > 0 && (
                      <div className="suggestions">
                        {recommended.map((q) => (
                          <button key={q} onClick={() => void sendQuestion(q)}>
                            {q}
                            <ArrowUpRight size={13} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {state.messages.map((m) => (
                  <article key={m.id} className={`message ${m.role}`}>
                    <span className="message-label">
                      {m.role === "user" ? "You" : "TubeDeck"}
                      {m.incomplete ? " · stopped" : ""}
                    </span>
                    <Markdown text={m.text} sources={m.sources} seek={seek} />
                    {m.sources && <Sources sources={m.sources} />}
                  </article>
                ))}
                {result && (
                  <article className="answer-card">
                    <div className="section-heading">
                      <span className="eyebrow">{result.title}</span>
                      <button
                        className="icon-button"
                        aria-label="Close explanation"
                        onClick={() => setResult(null)}
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <Markdown
                      text={result.text}
                      sources={result.sources}
                      seek={seek}
                    />
                    {result.searchUsed === false && (
                      <p className="quiet">
                        No web search evidence returned for this answer.
                      </p>
                    )}
                    <Sources sources={result.sources} />
                    <SearchSuggestions html={result.searchSuggestions} />
                    {result.productSearch && (
                      <a
                        className="text-button"
                        href={`https://www.google.com/search?q=${encodeURIComponent(result.productSearch)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Search Google
                        <ExternalLink size={13} />
                      </a>
                    )}
                    <div className="row">
                      <button
                        className="secondary"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void run("Saving note", async () => {
                            await addNote({
                              title: result.title,
                              body: result.text,
                              sources: result.sources,
                            });
                            setNotice("Saved to notes.");
                          })
                        }
                      >
                        <Bookmark size={14} />
                        Save note
                      </button>
                      {hover && (
                        <button
                          className="secondary"
                          disabled={disabled}
                          onClick={() => void explain(hover.text, true)}
                        >
                          Explain deeper
                          <ArrowUpRight size={14} />
                        </button>
                      )}
                    </div>
                  </article>
                )}
                {busy && stream && (
                  <article className="message assistant streaming">
                    <span className="message-label">TubeDeck</span>
                    <Markdown text={stream} seek={seek} />
                  </article>
                )}
              </div>
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendQuestion();
                }}
              >
                <textarea
                  rows={1}
                  aria-label="Ask about this video"
                  placeholder={
                    state.active
                      ? "Ask anything about this video…"
                      : "Activate this video to start a conversation…"
                  }
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!disabled) void sendQuestion();
                    }
                  }}
                />
                <button
                  className="send-button"
                  aria-label="Send question"
                  disabled={disabled || !question.trim()}
                >
                  <ArrowUp size={18} />
                </button>
              </form>
            </section>
            <aside className="context-rail">
              <span className="eyebrow">Your video, connected</span>
              <div className="video-summary">
                <span className="video-icon">
                  <Play size={16} />
                </span>
                <h2>{video?.title || "Open a YouTube video"}</h2>
                <p>
                  {video?.channel || "YouTube"}
                  {video?.duration ? ` · ${timeLabel(video.duration)}` : ""}
                </p>
              </div>
              <div className="rail-actions">
                <button
                  disabled={disabled}
                  onClick={() => void analyze("summary", "Video overview")}
                >
                  <FileText size={17} />
                  <span>
                    <b>Give me the overview</b>
                    <small>Key ideas, with timestamps</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
                <button disabled={disabled} onClick={() => void visualNotes()}>
                  <Camera size={17} />
                  <span>
                    <b>Keep the visual moments</b>
                    <small>Useful frames, thoughtful notes</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
                {productsSuggested && (
                  <button
                    disabled={disabled}
                    onClick={() => void listProducts()}
                  >
                    <ShoppingBag size={17} />
                    <span>
                      <b>List products</b>
                      <small>Choose an object in this frame</small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                )}
                <button onClick={() => setTab("comments")}>
                  <MessageCircle size={17} />
                  <span>
                    <b>What are viewers saying?</b>
                    <small>Explore the discussion</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              </div>
              <div className="privacy-note">
                <ShieldCheck size={15} />
                <span>
                  Starts with your click.
                  <br />
                  Your notes stay on this device.
                </span>
              </div>
            </aside>
          </div>
          <section
            className="full-pane panel-task"
            id="task-transcript"
            role="region"
            aria-labelledby="panel-transcript"
            hidden={tab !== "transcript"}
          >
            <div className="pane-toolbar">
              <div>
                <h2>Follow every word</h2>
                <p>
                  {state.transcript?.detail ||
                    "Load the transcript, or paste one if captions aren’t available."}
                </p>
              </div>
              <div className="row">
                <button
                  className="secondary"
                  disabled={disabled}
                  onClick={() =>
                    void run("Reading transcript", async () => {
                      const transcript = await rpc<Transcript>("transcript");
                      setState((s) => ({ ...s, transcript }));
                    })
                  }
                >
                  Reload
                </button>
                <button className="secondary" onClick={() => setPaste(!paste)}>
                  <Clipboard size={14} />
                  Paste
                </button>
              </div>
            </div>
            {paste && (
              <div className="paste-box">
                <textarea
                  aria-label="Paste transcript"
                  placeholder="[0:00] First line…"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <button
                  className="primary"
                  disabled={!pasteText.trim() || Boolean(busy)}
                  onClick={() =>
                    void run("Importing transcript", async () => {
                      const transcript = await rpc<Transcript>(
                        "transcript-paste",
                        { text: pasteText },
                      );
                      setState((s) => ({ ...s, transcript }));
                      setPaste(false);
                      setNotice(
                        "Transcript imported. Untimed lines stay untimed.",
                      );
                    })
                  }
                >
                  Use transcript
                </button>
              </div>
            )}
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Find in transcript"
                placeholder="Find a word or moment"
                value={find}
                onChange={(e) => setFind(e.target.value)}
              />
              <span>{filteredSegments.length} lines</span>
            </label>
            <div className="transcript-list">
              {filteredSegments.slice(0, 600).map((s, i) => (
                <div key={`${s.start}:${i}`} className="transcript-line">
                  <button
                    className="time-link"
                    disabled={s.start === null}
                    onClick={() => s.start !== null && seek(s.start)}
                  >
                    {timeLabel(s.start)}
                  </button>
                  <p onMouseLeave={() => clearTimeout(hoverTimer.current)}>
                    {s.text.split(/(\s+)/).map((word, k) =>
                      /^\s+$/.test(word) ? (
                        word
                      ) : (
                        <span
                          key={k}
                          onMouseEnter={() =>
                            hoverText(word, s.start ?? undefined, s.text)
                          }
                        >
                          {word}
                        </span>
                      ),
                    )}
                  </p>
                  <button
                    className="line-action"
                    disabled={disabled}
                    onClick={() => {
                      setHover({
                        text: s.text,
                        time: s.start ?? undefined,
                      });
                      setTab("chat");
                      void explain(s.text, true);
                    }}
                    title="Explain this line"
                  >
                    <CircleHelp size={14} />
                  </button>
                  <button
                    className="line-action"
                    disabled={disabled}
                    title="Fact-check this line"
                    onClick={() => {
                      setTab("chat");
                      void run("Checking this claim", async () =>
                        show(
                          "Evidence check",
                          await ai("check", { selection: s.text }),
                        ),
                      );
                    }}
                  >
                    <ShieldCheck size={14} />
                  </button>
                </div>
              ))}
            </div>
            {filteredSegments.length > 600 && (
              <p className="quiet">
                Showing the first 600 matches. Refine your search to find
                another passage.
              </p>
            )}
          </section>
          <section
            className="full-pane panel-task"
            id="task-notes"
            role="region"
            aria-labelledby="panel-notes"
            hidden={tab !== "notes"}
          >
            <div className="pane-toolbar">
              <div>
                <h2>Keep what matters.</h2>
                <p>Notes and visual moments, in the order they happened.</p>
              </div>
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => void visualNotes()}
              >
                <Sparkles size={14} />
                Capture visual notes
              </button>
            </div>
            <div className="note-composer">
              <input
                placeholder="Write a thought worth keeping…"
                aria-label="New note"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <button
                className="icon-button"
                aria-label="Save note at current time"
                disabled={!noteText.trim() || Boolean(busy)}
                onClick={() =>
                  void run("Saving note", async () => {
                    const c = await page("context");
                    await addNote({
                      title: "My note",
                      body: noteText,
                      time: c.time,
                    });
                    setNoteText("");
                  })
                }
              >
                <Plus size={18} />
              </button>
              <button
                className="secondary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run("Saving screenshot", async () => {
                    const c = await page("capture");
                    await addNote({
                      title: "Captured moment",
                      body: noteText,
                      time: c.time,
                      image: c.image,
                      kind: "screenshot",
                    });
                    setNoteText("");
                  })
                }
              >
                <Camera size={15} />
                Capture now
              </button>
            </div>
            {state.notes.length === 0 ? (
              <Empty
                Icon={Bookmark}
                title="A home for your takeaways"
                text="Save a thought, capture a frame, or let AI find the visual moments."
              />
            ) : (
              <div className="notes-grid">
                {state.notes.map((n) => (
                  <article className="note-card" key={n.id}>
                    <div className="note-meta">
                      <button
                        className="time-link"
                        disabled={n.time === null}
                        onClick={() => n.time !== null && seek(n.time)}
                      >
                        {timeLabel(n.time)}
                      </button>
                      <span>{n.kind}</span>
                      <button
                        className="icon-button"
                        aria-label={`Delete ${n.title}`}
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void run("Deleting note", async () => {
                            const notes = await rpc<Note[]>("note-delete", {
                              id: n.id,
                            });
                            setState((s) => ({ ...s, notes }));
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {n.image && (
                      <img src={n.image} alt={n.title} loading="lazy" />
                    )}
                    <h3>{n.title}</h3>
                    {["quiz", "flashcards"].includes(n.kind) ? (
                      <button
                        className="secondary"
                        onClick={() => {
                          try {
                            n.kind === "quiz"
                              ? setQuiz(quizSchema.parse(parseJson(n.body)))
                              : setCards(cardsSchema.parse(parseJson(n.body)));
                            setCardIndex(0);
                            setFlipped(false);
                            setAnswers({});
                            setTab("tools");
                          } catch {
                            setError("This saved study set could not be read.");
                          }
                        }}
                      >
                        Open saved {n.kind}
                      </button>
                    ) : (
                      <>
                        <p
                          className="note-body"
                          onMouseLeave={() => clearTimeout(hoverTimer.current)}
                        >
                          {n.body.split(/(\s+)/).map((w, i) =>
                            /^\s+$/.test(w) ? (
                              w
                            ) : (
                              <span
                                key={i}
                                onMouseEnter={() =>
                                  hoverText(
                                    w,
                                    n.time ?? undefined,
                                    n.body.slice(0, 1500),
                                  )
                                }
                              >
                                {w}
                              </span>
                            ),
                          )}
                        </p>
                        <details className="note-editor">
                          <summary>Edit note</summary>
                          <textarea
                            aria-label={`Edit ${n.title}`}
                            defaultValue={n.body}
                            onBlur={(e) => {
                              if (e.target.value !== n.body)
                                void bridge
                                  .request<Note[]>("note-save", {
                                    note: { ...n, body: e.target.value },
                                  })
                                  .promise.then((notes) =>
                                    setState((s) => ({ ...s, notes })),
                                  )
                                  .catch((e) => setError(e.message));
                            }}
                          />
                        </details>
                        <Sources sources={n.sources ?? []} />
                        <button
                          className="text-button"
                          disabled={disabled}
                          onClick={() => {
                            setTab("chat");
                            void explain(n.body, true);
                          }}
                        >
                          Explain note
                          <ArrowUpRight size={13} />
                        </button>
                      </>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
          <section
            className="full-pane panel-task"
            id="task-comments"
            role="region"
            aria-labelledby="panel-comments"
            hidden={tab !== "comments"}
          >
            <div className="pane-toolbar">
              <div>
                <h2>The other side of the video.</h2>
                <p>
                  {state.comments
                    ? `${state.comments.items.length.toLocaleString()} top-level comments · ${state.comments.complete ? "Reached end of accessible results" : "Partial coverage"}`
                    : "Load the discussion, see the overall reaction, then find something specific."}
                </p>
              </div>
              <button
                className="primary"
                disabled={Boolean(busy)}
                onClick={() => void loadDiscussion()}
              >
                <MessageCircle size={15} />
                {state.comments ? "Load again" : "Load comments"}
              </button>
            </div>
            {state.comments && (
              <p className="coverage">{state.comments.detail}</p>
            )}
            {commentSummary && (
              <article className="discussion-summary">
                <span className="eyebrow">{commentSummary.title}</span>
                <Markdown
                  text={commentSummary.text}
                  sources={commentSummary.sources}
                />
                <Sources sources={commentSummary.sources} />
              </article>
            )}
            {state.comments && (
              <>
                <form
                  className="search-field"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("Searching viewer comments", async () => {
                      const r = await ai("comment-question", {
                        question: commentQuery,
                      });
                      setCommentSummary({
                        title: "Related comments",
                        ...r,
                      });
                      setStream("");
                    });
                  }}
                >
                  <Search size={16} />
                  <input
                    aria-label="Find or ask about comments"
                    placeholder="Find a keyword, or ask what viewers think…"
                    value={commentQuery}
                    onChange={(e) => setCommentQuery(e.target.value)}
                  />
                  <button
                    className="text-button"
                    disabled={disabled || !commentQuery.trim()}
                  >
                    Ask AI
                    <ArrowUpRight size={14} />
                  </button>
                </form>
                <div className="row">
                  <span className="quiet">
                    {filteredComments.length.toLocaleString()} keyword matches
                  </span>
                  <button
                    className="text-button"
                    disabled={disabled || !state.comments.items.length}
                    onClick={() =>
                      void run("Summarizing viewer thoughts", async () => {
                        setCommentSummary({
                          title: "What viewers think",
                          ...(await ai("comments")),
                        });
                        setStream("");
                      })
                    }
                  >
                    Summarize loaded comments
                  </button>
                </div>
                <div className="comment-list">
                  {filteredComments.slice(0, 100).map((c) => (
                    <article key={c.id}>
                      <div>
                        <strong>{c.author}</strong>
                        <span>{c.likes} likes</span>
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open comment"
                        >
                          <ExternalLink size={13} />
                        </a>
                      </div>
                      <p>{c.text}</p>
                    </article>
                  ))}
                </div>
                {filteredComments.length > 100 && (
                  <p className="quiet">
                    First 100 matches displayed. Keyword search covers all
                    retrieved comments.
                  </p>
                )}
              </>
            )}
            {!state.comments && (
              <Empty
                Icon={MessageCircle}
                title="A whole discussion to explore"
                text="Loading reads top-level comments only. You can stop whenever you have enough."
              />
            )}
          </section>
          <section
            className="full-pane panel-task"
            id="task-downloads"
            role="region"
            aria-labelledby="panel-downloads"
            hidden={tab !== "downloads"}
          >
            <div className="pane-toolbar">
              <div>
                <h2>Save this video.</h2>
                <p>Choose from the quality options available for this video.</p>
              </div>
            </div>
            <div className="download-launch">
              <Download size={32} aria-hidden="true" />
              <h3>{video?.title || "Your current video"}</h3>
              <p>
                The download manager opens in a new tab, where you can choose a
                quality, save location, and stop a download.
              </p>
              <button
                className="primary"
                onClick={() =>
                  void bridge
                    .request("download-open")
                    .promise.catch((e) => setError(e.message))
                }
              >
                Open download manager
              </button>
            </div>
          </section>
          <section
            className="full-pane panel-task"
            id="task-tools"
            role="region"
            aria-labelledby="panel-tools"
            hidden={tab !== "tools"}
          >
            <div className="pane-toolbar">
              <div>
                <h2>More tools.</h2>
                <p>Every action starts with you.</p>
              </div>
            </div>
            <div className="tools-grid">
              <Tool
                Icon={PackageOpen}
                title="Context capsule"
                text="Take your notes and conversation to another AI."
              >
                <button
                  className="secondary"
                  onClick={() => setCapsuleOpen(true)}
                >
                  Create capsule
                </button>
              </Tool>
              <Tool
                Icon={SkipForward}
                title="Skip paid promotions"
                text={
                  sponsorOn
                    ? `${sponsorSegments.length} segments · enabled for this video`
                    : "Transcript-guided. Uncertain matches stay manual."
                }
              >
                <button
                  className={sponsorOn ? "secondary" : "primary"}
                  disabled={disabled}
                  onClick={() => void toggleSponsors()}
                >
                  {sponsorOn ? "Turn off" : "Enable for this video"}
                </button>
              </Tool>
              <Tool
                Icon={ShoppingBag}
                title="What’s in the frame?"
                text="Identify an object, then research the exact product."
              >
                <button
                  className="secondary"
                  disabled={disabled}
                  onClick={() => void listProducts()}
                >
                  List products
                  <ArrowUpRight size={14} />
                </button>
              </Tool>
              <Tool
                Icon={Download}
                title="Download this video"
                text="Check available source formats, with audio. Up to 4K when accessible."
              >
                <button
                  className="secondary"
                  onClick={() =>
                    void bridge
                      .request("download-open")
                      .promise.catch((e) => setError(e.message))
                  }
                >
                  View available formats
                  <ArrowUpRight size={14} />
                </button>
              </Tool>
              <Tool
                Icon={BookOpen}
                title="Make it stick"
                text="Create a quiz or flashcards from this video."
              >
                <div className="row">
                  <button
                    className="secondary"
                    disabled={disabled}
                    onClick={() => void study("quiz")}
                  >
                    Quiz
                  </button>
                  <button
                    className="secondary"
                    disabled={disabled}
                    onClick={() => void study("flashcards")}
                  >
                    Flashcards
                  </button>
                </div>
              </Tool>
              <Tool
                Icon={Play}
                title="Your pace"
                text="Set a comfortable playback speed."
              >
                <select
                  aria-label="Playback speed"
                  defaultValue="1"
                  onChange={(e) =>
                    void bridge
                      .request("page", {
                        command: "speed",
                        args: { rate: Number(e.target.value) },
                      })
                      .promise.catch((e) => setError(e.message))
                  }
                >
                  {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((r) => (
                    <option key={r} value={r}>
                      {r}× speed
                    </option>
                  ))}
                </select>
              </Tool>
              <Tool
                Icon={Repeat2}
                title="Repeat a moment"
                text={`A: ${timeLabel(loopA)} · B: ${timeLabel(loopB)}`}
              >
                <div className="row">
                  <button
                    className="secondary"
                    onClick={() =>
                      void bridge
                        .request<Video>("page", { command: "context" })
                        .promise.then((c) => setLoopA(c.time))
                        .catch((e) => setError(e.message))
                    }
                  >
                    Set A
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      void bridge
                        .request<Video>("page", { command: "context" })
                        .promise.then((c) => setLoopB(c.time))
                        .catch((e) => setError(e.message))
                    }
                  >
                    Set B
                  </button>
                  <button
                    className="secondary"
                    disabled={
                      loopA === null || loopB === null || loopB <= loopA
                    }
                    onClick={() =>
                      void bridge
                        .request("page", {
                          command: "loop",
                          args: { a: loopA, b: loopB, enabled: true },
                        })
                        .promise.then(() => setNotice("A–B repeat enabled."))
                        .catch((e) => setError(e.message))
                    }
                  >
                    Loop
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Stop repeat"
                    onClick={() =>
                      void bridge
                        .request("page", {
                          command: "loop",
                          args: { enabled: false },
                        })
                        .promise.then(() => setNotice("Repeat stopped."))
                        .catch((e) => setError(e.message))
                    }
                  >
                    <Square size={13} />
                  </button>
                </div>
              </Tool>
              <Tool
                Icon={Focus}
                title="Less distraction"
                text="Choose what stays around the video."
              >
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={focusRecommendations}
                    onChange={(e) => {
                      setFocusRecommendations(e.target.checked);
                      void bridge
                        .request("page", {
                          command: "focus",
                          args: {
                            recommendations: e.target.checked,
                            comments: focusComments,
                          },
                        })
                        .promise.catch((e) => setError(e.message));
                    }}
                  />
                  Hide recommendations
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={focusComments}
                    onChange={(e) => {
                      setFocusComments(e.target.checked);
                      void bridge
                        .request("page", {
                          command: "focus",
                          args: {
                            recommendations: focusRecommendations,
                            comments: e.target.checked,
                          },
                        })
                        .promise.catch((e) => setError(e.message));
                    }}
                  />
                  Hide comments
                </label>
              </Tool>
              <Tool
                Icon={Bookmark}
                title="Remember this moment"
                text="Save a timestamp without using AI."
              >
                <button
                  className="secondary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("Saving bookmark", async () => {
                      const c = await page("context");
                      await addNote({
                        title: "Bookmarked moment",
                        time: c.time,
                        kind: "bookmark",
                      });
                      setNotice("Bookmark saved.");
                    })
                  }
                >
                  Bookmark now
                </button>
              </Tool>
            </div>
            {objects.length > 0 && (
              <div className="objects">
                <h3>Choose the object you mean</h3>
                <div className="objects-grid">
                  {objects.map((o, i) => (
                    <div className="object-card" key={i}>
                      <strong>{o.name}</strong>
                      <p>{o.description}</p>
                      <button
                        className="secondary"
                        disabled={disabled}
                        onClick={() => void product(o)}
                      >
                        Identify & research
                        <ArrowUpRight size={13} />
                      </button>
                      <a
                        className="text-button"
                        href={`https://www.google.com/search?q=${encodeURIComponent(o.name + " " + o.description)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Search Google
                        <ExternalLink size={13} />
                      </a>
                      <a
                        className="text-button"
                        href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(o.name + " " + o.description)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Search images by name
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  ))}
                </div>
                <p className="quiet">
                  Image search uses the object’s description; it is not
                  reverse-image matching.
                </p>
              </div>
            )}
            {quiz && (
              <div className="study-set">
                <h3>Check your understanding</h3>
                {quiz.questions.map((q, i) => (
                  <article key={i}>
                    <h4>
                      {i + 1}. {q.question}
                    </h4>
                    <div className="quiz-options">
                      {q.options.map((o, j) => (
                        <button
                          className={`secondary ${answers[i] === j ? "chosen" : ""}`}
                          key={j}
                          onClick={() => setAnswers((a) => ({ ...a, [i]: j }))}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                    {answers[i] !== undefined && (
                      <p className="quiz-feedback">
                        {answers[i] === q.answer
                          ? "Correct."
                          : "Not quite. " + q.options[q.answer] + "."}{" "}
                        {q.explanation}{" "}
                        {q.time !== null && (
                          <button
                            className="time-link"
                            onClick={() => seek(q.time!)}
                          >
                            {timeLabel(q.time)}
                          </button>
                        )}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
            {cards && cards.cards.length > 0 && (
              <div className="study-set">
                <div className="section-heading">
                  <h3>Flashcards</h3>
                  <span className="quiet">
                    {cardIndex + 1} / {cards.cards.length}
                  </span>
                </div>
                <button
                  className={`flashcard ${flipped ? "flipped" : ""}`}
                  onClick={() => setFlipped(!flipped)}
                >
                  <span className="eyebrow">
                    {flipped ? "Answer" : "Question"}
                  </span>
                  <p>
                    {flipped
                      ? cards.cards[cardIndex].back
                      : cards.cards[cardIndex].front}
                  </p>
                  <small>Click to flip</small>
                </button>
                <div className="row">
                  <button
                    className="secondary"
                    onClick={() => {
                      setCardIndex(
                        (cardIndex - 1 + cards.cards.length) %
                          cards.cards.length,
                      );
                      setFlipped(false);
                    }}
                  >
                    <ChevronLeft size={14} />
                    Previous
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setCardIndex((cardIndex + 1) % cards.cards.length);
                      setFlipped(false);
                    }}
                  >
                    Next
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
        <footer className="statusbar">
          <span>
            {state.active
              ? "AI active for this video"
              : "AI is quiet until activated"}
          </span>
          <span>
            {state.tokens
              ? `${state.tokens.toLocaleString()} tokens reported`
              : "Your key. Your control."}
          </span>
        </footer>
      </div>
      {collapsed && error && (
        <div className="banner error panel-alert" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {collapsed && notice && (
        <div className="banner panel-alert" role="status">
          <span>{notice}</span>
          <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}

      {hoverOpen && hover && (
        <aside
          className="hover-card"
          role="dialog"
          aria-label="Quick explanation"
        >
          <div className="section-heading">
            <strong>{hover.text}</strong>
            <button
              className="icon-button"
              aria-label="Close quick explanation"
              onClick={() => setHoverOpen(false)}
            >
              <X size={15} />
            </button>
          </div>
          {hoverResult ? (
            <>
              <Markdown text={hoverResult.text} sources={hoverResult.sources} />
              <Sources sources={hoverResult.sources} />
              <SearchSuggestions html={hoverResult.searchSuggestions} />
            </>
          ) : (
            <p className="quiet">{busy || "No explanation returned."}</p>
          )}
          <div className="row">
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => {
                setHoverOpen(false);
                void explain(hover.text, true, hover.context);
              }}
            >
              Explain deeper
            </button>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => {
                setHoverOpen(false);
                setTab("chat");
                void run("Checking this claim", async () =>
                  show(
                    "Evidence check",
                    await ai("check", {
                      selection: hover.context || hover.text,
                    }),
                  ),
                );
              }}
            >
              Check
            </button>
            {busy && (
              <button className="stop-button" onClick={stop}>
                Stop
              </button>
            )}
          </div>
        </aside>
      )}
      {capsuleOpen && (
        <Dialog
          label="Export context capsule"
          onClose={() => setCapsuleOpen(false)}
        >
          <div className="section-heading">
            <PackageOpen size={24} />
            <button
              className="icon-button"
              aria-label="Close capsule"
              onClick={() => setCapsuleOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <h2>Take the context with you.</h2>
          <p>
            Continue in another AI with this video’s transcript, saved notes,
            conversation, retrieved comments, and research sources.
          </p>
          <button
            className="primary"
            onClick={() => void exportCapsule("copy")}
          >
            <Clipboard size={15} />
            Copy full context
          </button>
          <button
            className="secondary"
            onClick={() => void exportCapsule("compact")}
          >
            Copy compact context · notes and conversation
          </button>
          <button
            className="secondary"
            onClick={() => void exportCapsule("zip")}
          >
            <Download size={15} />
            Download with saved images
          </button>
          <span className="quiet">
            Copied text describes saved images. The ZIP includes the actual
            files. Credentials are always excluded.
          </span>
        </Dialog>
      )}
    </main>
  );
}
function Empty({
  Icon,
  title,
  text,
}: {
  Icon: typeof MessageCircle;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <span>
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Tool({
  Icon,
  title,
  text,
  children,
}: {
  Icon: typeof MessageCircle;
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <article className="tool">
      <Icon size={20} />
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </article>
  );
}
