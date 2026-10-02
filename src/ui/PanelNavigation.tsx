import {
  BookOpen,
  Download,
  ListVideo,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Settings2,
  Sparkles,
  Square,
  LoaderCircle,
} from "lucide-react";
import type { KeyboardEvent } from "react";

export const panelItems = [
  { id: "chat", label: "Ask AI", Icon: Sparkles },
  { id: "transcript", label: "Transcript", Icon: ListVideo },
  { id: "notes", label: "Notes", Icon: BookOpen },
  { id: "comments", label: "Comments", Icon: MessageCircle },
  { id: "downloads", label: "Downloads", Icon: Download },
  { id: "tools", label: "More", Icon: MoreHorizontal },
] as const;
export type PanelTask = (typeof panelItems)[number]["id"];

export function PanelNavigation({
  task,
  expanded,
  active,
  busy,
  notes,
  onSelect,
  onActivate,
  onPause,
  onStop,
  onSettings,
}: {
  task: PanelTask;
  expanded: boolean;
  active: boolean;
  busy: string;
  notes: number;
  onSelect: (task: PanelTask) => void;
  onActivate: () => void;
  onPause: () => void;
  onStop: () => void;
  onSettings: () => void;
}) {
  function navigate(event: KeyboardEvent<HTMLElement>) {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(".panel-item"),
    );
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % buttons.length
        : event.key === "ArrowLeft"
          ? (index + buttons.length - 1) % buttons.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : -1;
    if (next >= 0) {
      event.preventDefault();
      buttons[next].focus();
    }
  }
  return (
    <div className="panel-navigation">
      <div className="panel-controls">
        <span className="panel-brand">
          <Play size={14} fill="currentColor" aria-hidden="true" /> TubeDeck
        </span>
        <span className="panel-control-spacer" />
        <button
          className={`panel-activation ${active ? "is-active" : ""}`}
          disabled={!active && Boolean(busy)}
          onClick={active ? onPause : onActivate}
        >
          {active ? <Pause size={14} /> : <Sparkles size={14} />}
          {active ? "Pause AI for this video" : "Activate for this video"}
        </button>
        <button
          className="icon-button"
          title="Settings"
          aria-label="Settings"
          onClick={onSettings}
        >
          <Settings2 size={17} />
        </button>
      </div>
      <nav
        className="panel-items"
        aria-label="TubeDeck tasks"
        onKeyDown={navigate}
      >
        {panelItems.map(({ id, label, Icon }) => (
          <button
            key={id}
            id={`panel-${id}`}
            className={`panel-item ${expanded && task === id ? "is-selected" : ""}`}
            aria-expanded={expanded && task === id}
            aria-controls={`task-${id}`}
            title={label}
            onClick={() => onSelect(id)}
          >
            <span className="panel-icon">
              <Icon size={16} aria-hidden="true" />
              {id === "notes" && notes > 0 && (
                <span
                  className="panel-count"
                  aria-label={`${notes} saved notes`}
                >
                  {notes > 99 ? "99+" : notes}
                </span>
              )}
            </span>
            <span>{label}</span>
            <span className="panel-selection" aria-hidden="true" />
          </button>
        ))}
      </nav>
      {busy && (
        <div className="panel-progress">
          <span className="panel-progress-label" role="status">
            <LoaderCircle size={14} className="spin" aria-hidden="true" />
            {busy}
          </span>
          <button className="stop-button" onClick={onStop}>
            <Square size={11} fill="currentColor" />
            Stop
          </button>
        </div>
      )}
    </div>
  );
}
