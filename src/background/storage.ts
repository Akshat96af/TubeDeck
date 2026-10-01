import { openDB } from "idb";
import type { Note, Settings } from "../shared/types";
const db = openDB("youtube-companion", 1, {
  upgrade(db) {
    db.createObjectStore("notes", { keyPath: "id" }).createIndex(
      "videoId",
      "videoId",
    );
  },
});
export async function notesFor(videoId: string): Promise<Note[]> {
  return (await (await db).getAllFromIndex("notes", "videoId", videoId)).sort(
    (a: Note, b: Note) => (a.time ?? Infinity) - (b.time ?? Infinity),
  );
}
export async function saveNote(note: Note) {
  await (await db).put("notes", note);
}
export async function deleteNote(id: string) {
  await (await db).delete("notes", id);
}
export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get(["settings", "geminiKey"]);
  const session = await chrome.storage.session.get("geminiKey");
  return {
    model: "gemini-flash-latest",
    firebaseApiKey: "",
    googleClientId: "",
    rememberKey: false,
    ...(typeof s.settings === "object" && s.settings ? s.settings : {}),
    hasKey: Boolean(session.geminiKey || s.geminiKey),
  };
}
export async function getGeminiKey(): Promise<string> {
  const session = await chrome.storage.session.get("geminiKey");
  const local = await chrome.storage.local.get("geminiKey");
  const key = session.geminiKey || local.geminiKey;
  if (typeof key !== "string" || !key)
    throw new Error("Add your Gemini API key in settings.");
  return key;
}
export async function setSettings(
  settings: Omit<Settings, "hasKey">,
  key?: string,
) {
  const existing = await getGeminiKey().catch(() => "");
  await chrome.storage.local.set({ settings });
  const next = key?.trim() || existing;
  if (next)
    await (
      settings.rememberKey ? chrome.storage.local : chrome.storage.session
    ).set({ geminiKey: next });
  await (
    settings.rememberKey ? chrome.storage.session : chrome.storage.local
  ).remove("geminiKey");
}
export async function clearKey() {
  await chrome.storage.local.remove("geminiKey");
  await chrome.storage.session.remove("geminiKey");
}
