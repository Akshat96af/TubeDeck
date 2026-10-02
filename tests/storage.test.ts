import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("idb", () => ({ openDB: async () => ({}) }));
vi.mock("../src/background/app-config", () => ({
  getAppConfig: async () => ({
    firebaseApiKey: "maintainer-firebase",
    googleClientId: "maintainer-client",
  }),
}));
let local: Record<string, unknown>, session: Record<string, unknown>;
const settings = {
  model: "test-model",
  firebaseApiKey: "",
  googleClientId: "",
  rememberKey: false,
};
function area(state: Record<string, unknown>) {
  return {
    get: async () => structuredClone(state),
    set: async (v: any) => {
      Object.assign(state, v);
    },
    remove: async (k: string) => {
      delete state[k];
    },
  };
}
beforeEach(() => {
  vi.resetModules();
  local = {};
  session = {};
  vi.stubGlobal("chrome", {
    storage: { local: area(local), session: area(session) },
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("user key lifetime", () => {
  it("uses the packaged project even when old settings contain empty or different identifiers", async () => {
    local.settings = {
      ...settings,
      firebaseApiKey: "old-project",
      googleClientId: "",
    };
    const storage = await import("../src/background/storage");
    expect(await storage.getSettings()).toMatchObject({
      firebaseApiKey: "maintainer-firebase",
      googleClientId: "maintainer-client",
    });
    await storage.setSettings(settings);
    expect(local.settings).toEqual({
      model: settings.model,
      rememberKey: false,
    });
  });
  it("keeps default keys in session storage and returns only a presence flag", async () => {
    const storage = await import("../src/background/storage");
    await storage.setSettings(settings, "test-private-value");
    expect(session.geminiKey).toBe("test-private-value");
    expect(local.geminiKey).toBeUndefined();
    const visible = await storage.getSettings();
    expect(visible.hasKey).toBe(true);
    expect(JSON.stringify(visible)).not.toContain("test-private-value");
  });
  it("moves a remembered key back to session when remembering is disabled", async () => {
    const storage = await import("../src/background/storage");
    await storage.setSettings(
      { ...settings, rememberKey: true },
      "test-private-value",
    );
    expect(local.geminiKey).toBe("test-private-value");
    await storage.setSettings(settings);
    expect(local.geminiKey).toBeUndefined();
    expect(session.geminiKey).toBe("test-private-value");
  });
  it("removes both possible copies", async () => {
    local.geminiKey = "old";
    session.geminiKey = "new";
    const storage = await import("../src/background/storage");
    await storage.clearKey();
    await expect(storage.getGeminiKey()).rejects.toThrow("Add your Gemini");
    expect((await storage.getSettings()).hasKey).toBe(false);
  });
});
