import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
function mockFetch(implementation: () => Promise<Response>) {
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}` },
  });
  vi.stubGlobal("fetch", vi.fn(implementation));
}
describe("packaged app configuration", () => {
  it("loads only the packaged asset, coalesces reads, and exposes only public identifiers", async () => {
    mockFetch(async () =>
      Response.json({
        firebaseApiKey: "public-firebase",
        googleClientId: "public-client",
        unexpected: "not exposed",
      }),
    );
    const { getAppConfig } = await import("../src/background/app-config");
    const [first, second] = await Promise.all([getAppConfig(), getAppConfig()]);
    expect(first).toEqual({
      firebaseApiKey: "public-firebase",
      googleClientId: "public-client",
    });
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "chrome-extension://fixture/app-config.json",
    );
  });
  it("fails closed and permits retry if the asset is missing or malformed", async () => {
    mockFetch(async () => new Response("", { status: 404 }));
    const { getAppConfig } = await import("../src/background/app-config");
    await expect(getAppConfig()).rejects.toThrow("missing");
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ googleClientId: "client" }),
    );
    await expect(getAppConfig()).rejects.toThrow("invalid");
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ firebaseApiKey: "public", googleClientId: "client" }),
    );
    await expect(getAppConfig()).resolves.toMatchObject({
      firebaseApiKey: "public",
    });
  });
});
