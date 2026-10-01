import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  ExternalLink,
  KeyRound,
  LogIn,
  LogOut,
  Play,
  ShieldCheck,
  Settings2,
} from "lucide-react";
import type { Settings, PublicUser, Snapshot } from "../shared/types";
import { bridge, isPreview } from "../ui/rpc";
import "../ui/styles.css";
function SettingsApp() {
  const [settings, setSettings] = useState<Settings>({
      model: "gemini-flash-latest",
      firebaseApiKey: "",
      googleClientId: "",
      rememberKey: false,
      hasKey: false,
    }),
    [key, setKey] = useState(""),
    [user, setUser] = useState<PublicUser | undefined>(),
    [models, setModels] = useState<{ id: string; name: string }[]>([]),
    [busy, setBusy] = useState(false),
    [cancellable, setCancellable] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const redirect = isPreview
    ? "Available after loading the extension"
    : chrome.identity.getRedirectURL();
  useEffect(() => {
    document.documentElement.dataset.theme = matchMedia(
      "(prefers-color-scheme:dark)",
    ).matches
      ? "dark"
      : "light";
    bridge
      .request<Snapshot>("snapshot")
      .promise.then((s) => {
        setSettings(s.settings);
        setUser(s.user);
      })
      .catch((e) => setError(e.message));
    const auth = (event: string, data: PublicUser | undefined) => {
      if (event === "auth") setUser(data ?? undefined);
    };
    bridge.listeners.add(auth);
    return () => {
      bridge.listeners.delete(auth);
    };
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
      setCancellable("");
    }
  }
  async function save() {
    const result = await bridge.request<Settings>("settings-save", {
      settings,
      key: key || undefined,
    }).promise;
    setSettings(result);
    setKey("");
    setNotice("Settings saved on this device.");
  }
  return (
    <main className="settings-shell">
      <header className="settings-header">
        <span className="brand-mark">
          <Play size={17} fill="currentColor" />
        </span>
        <div>
          <h1>TubeDeck settings</h1>
          <span className="quiet">A little more from every video.</span>
        </div>
      </header>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="banner" role="status">
          <Check size={15} />
          {notice}
        </p>
      )}
      <section className="settings-card">
        <ShieldCheck size={22} />
        <h2>Connect your account</h2>
        <p>
          Google sign-in is required for AI features. Your Gemini API usage
          stays on your own key.
        </p>
        {user ? (
          <>
            <p>
              <strong>{user.name}</strong>
              <br />
              {user.email}
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await bridge.request("sign-out").promise;
                  setUser(undefined);
                })
              }
            >
              <LogOut size={15} />
              Sign out
            </button>
          </>
        ) : (
          <button
            className="primary"
            disabled={
              busy || !settings.firebaseApiKey || !settings.googleClientId
            }
            onClick={() =>
              void run(async () => {
                await save();
                setUser(await bridge.request<PublicUser>("sign-in").promise);
              })
            }
          >
            <LogIn size={15} />
            Sign in with Google
          </button>
        )}
      </section>
      <section className="settings-card">
        <KeyRound size={22} />
        <h2>Your Gemini connection</h2>
        <p>
          AI runs only after activation for a video. Keys are never sent to
          YouTube or included in exports.
        </p>
        <label className="field">
          Gemini API key
          <input
            type="password"
            autoComplete="off"
            value={key}
            placeholder={
              settings.hasKey
                ? "A key is already saved. Enter a new key to replace it."
                : "Paste your own Gemini API key"
            }
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <a
          className="text-button"
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
        >
          Get a key in Google AI Studio
          <ExternalLink size={12} />
        </a>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.rememberKey}
            onChange={(e) =>
              setSettings((s) => ({ ...s, rememberKey: e.target.checked }))
            }
          />
          Remember my key on this device
        </label>
        <p className="quiet">
          Unchecked: the key is cleared when the browser session ends. Local
          storage is not a password vault; anyone with access to this browser
          profile may be able to read a remembered key.
        </p>
        <label className="field">
          Gemini model
          <input
            list="models"
            value={settings.model}
            onChange={(e) =>
              setSettings((s) => ({ ...s, model: e.target.value }))
            }
          />
          <datalist id="models">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </datalist>
          <small>
            Choose a model that supports text, images, and Google Search.
            Availability depends on your API project.
          </small>
        </label>
        <div className="row">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run(save)}
          >
            Save connection
          </button>
          <button
            className="secondary"
            disabled={busy || (!key && !settings.hasKey)}
            onClick={() =>
              void run(async () => {
                await save();
                const task =
                  bridge.request<{ id: string; name: string }[]>("models");
                setCancellable(task.id);
                setModels(await task.promise);
                setNotice("Available models loaded. Choose one above.");
              })
            }
          >
            Load available models
          </button>
          {cancellable && (
            <button
              className="secondary"
              onClick={() => bridge.cancel(cancellable)}
            >
              Stop loading
            </button>
          )}
          <button
            className="text-button"
            disabled={busy || !settings.hasKey}
            onClick={() =>
              void run(async () => {
                await bridge.request("key-clear").promise;
                setSettings((s) => ({ ...s, hasKey: false }));
                setNotice("Gemini key removed.");
              })
            }
          >
            Remove key
          </button>
        </div>
      </section>
      <section className="settings-card">
        <Settings2 size={22} />
        <h2>Project configuration</h2>
        <p>
          For the project maintainer: connect the Firebase project used for
          Google sign-in. These are public client identifiers, not
          service-account credentials.
        </p>
        <label className="field">
          Firebase web API key
          <input
            value={settings.firebaseApiKey}
            autoComplete="off"
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                firebaseApiKey: e.target.value.trim(),
              }))
            }
          />
        </label>
        <label className="field">
          Google OAuth web client ID
          <input
            value={settings.googleClientId}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                googleClientId: e.target.value.trim(),
              }))
            }
          />
        </label>
        <label className="field">
          OAuth redirect URL
          <input readOnly value={redirect} />
          <small>
            Add this exact URL to your Google OAuth web client's authorized
            redirect URIs.
          </small>
        </label>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void run(save)}
        >
          Save project configuration
        </button>
        <details className="setup-details">
          <summary>Setup instructions</summary>
          <ol>
            <li>
              Create a Firebase project and enable Authentication → Google.
            </li>
            <li>
              Use its web API key above. Create a Google OAuth web application
              client and register the redirect URL shown here.
            </li>
            <li>
              Configure the OAuth consent screen and test users while the app is
              in testing.
            </li>
            <li>
              Use that web client ID above, save, then sign in. Never paste a
              client secret or service-account JSON here.
            </li>
          </ol>
          <p>
            There is no deployed backend or cloud sync in this build. Google
            sign-in gates the packaged client, but an open-source client can be
            modified; server-side enforcement is needed before offering
            developer-funded resources.
          </p>
        </details>
      </section>
      <p className="quiet">
        Notes and screenshots stay in this extension’s local database. Chats
        last for the current tab/session and may reset if the extension service
        worker restarts. Changing videos always disables AI. Stop prevents
        further queued work; already processed API usage may still be billed.
      </p>
      <nav className="row" aria-label="Project information">
        <a
          className="text-button"
          href="PRIVACY.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy
        </a>
        <a
          className="text-button"
          href="THIRD_PARTY_NOTICES.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          Licenses
        </a>
      </nav>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<SettingsApp />);
