import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getGeminiKey: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("../src/background/auth", () => ({
  requireUser: mocks.requireUser,
  user: async () => undefined,
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../src/background/storage", () => ({
  getSettings: async () => ({
    model: "test",
    firebaseApiKey: "",
    googleClientId: "",
    rememberKey: false,
    hasKey: true,
  }),
  getGeminiKey: mocks.getGeminiKey,
  notesFor: async () => [],
  saveNote: vi.fn(),
  deleteNote: vi.fn(),
  clearKey: vi.fn(),
  setSettings: vi.fn(),
}));
vi.mock("../src/background/gemini", () => ({
  generate: mocks.generate,
  listModels: vi.fn(),
}));
const video = {
  id: "abcdefghijk",
  title: "Example",
  channel: "Test",
  duration: 90,
  time: 0,
  dark: false,
  theatre: false,
};
let connect: (port: any) => void,
  message: (data: any, sender: any) => void,
  listener: (rpc: any) => Promise<void>,
  sent: any[],
  sendPage: ReturnType<typeof vi.fn>;
async function rpc(
  action: string,
  payload: any = {},
  id = crypto.randomUUID() as string,
) {
  await listener({ id, action, payload });
  return sent.findLast((m) => m.id === id);
}
beforeEach(async () => {
  vi.resetModules();
  sent = [];
  mocks.requireUser
    .mockReset()
    .mockResolvedValue({ name: "Tester", email: "test@example.test" });
  mocks.getGeminiKey.mockReset().mockResolvedValue("test-key");
  mocks.generate
    .mockReset()
    .mockResolvedValue({
      text: "Answer",
      sources: [],
      tokens: 1,
      searchUsed: false,
    });
  sendPage = vi.fn(async (_tab, m) => ({
    ok: true,
    data: m.command === "context" ? video : true,
  }));
  vi.stubGlobal("chrome", {
    storage: {
      local: { setAccessLevel: vi.fn() },
      session: { setAccessLevel: vi.fn() },
    },
    runtime: {
      getURL: (p: string) => "chrome-extension://fixture/" + p,
      onConnect: { addListener: (fn: any) => (connect = fn) },
      onMessage: { addListener: (fn: any) => (message = fn) },
    },
    tabs: { sendMessage: sendPage, onRemoved: { addListener: vi.fn() } },
    action: { onClicked: { addListener: vi.fn() } },
  });
  await import("../src/background/index");
  connect({
    name: "companion",
    sender: { url: "chrome-extension://fixture/panel.html", tab: { id: 1 } },
    postMessage: (m: any) => sent.push(m),
    onDisconnect: { addListener: vi.fn() },
    onMessage: { addListener: (fn: any) => (listener = fn) },
  });
});
describe("activation and task cancellation", () => {
  it("rejects AI calls until this video is activated", async () => {
    expect((await rpc("ai", { kind: "recommend" })).ok).toBe(false);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("requires both login and a user key", async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error("Sign in required"));
    expect((await rpc("activate")).ok).toBe(false);
    mocks.getGeminiKey.mockRejectedValueOnce(new Error("Key required"));
    expect((await rpc("activate")).ok).toBe(false);
    expect(
      sendPage.mock.calls.some(
        ([, m]) => m.command === "activation" && m.payload.active,
      ),
    ).toBe(false);
  });
  it("does not call AI just because activation succeeded", async () => {
    expect((await rpc("activate")).ok).toBe(true);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect((await rpc("ai", { kind: "recommend" })).ok).toBe(true);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
  it("rejects requests belonging to a previous video", async () => {
    await rpc("activate");
    expect(
      (await rpc("ai", { kind: "recommend", videoId: "differentID" })).ok,
    ).toBe(false);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("cancellation while identity is resolving prevents later AI generation", async () => {
    await rpc("activate");
    let release!: () => void;
    mocks.requireUser.mockImplementationOnce(
      () => new Promise<void>((r) => (release = r)),
    );
    const task = rpc("ai", { kind: "recommend" }, "pending");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await listener({
      id: "cancel-request",
      action: "cancel",
      payload: { id: "pending" },
    });
    release();
    expect((await task).error).toBe("Stopped");
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("deactivation cancels queued work and disallows future AI calls", async () => {
    await rpc("activate");
    await rpc("deactivate");
    expect((await rpc("ai", { kind: "recommend" })).ok).toBe(false);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("refuses empty comment analysis instead of inventing viewer opinions", async () => {
    await rpc("activate");
    expect((await rpc("ai", { kind: "comments" })).error).toBe(
      "Load some comments first.",
    );
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
