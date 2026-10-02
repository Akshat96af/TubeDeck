import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/background/storage", () => ({
  getSettings: async () => ({
    firebaseApiKey: "test-firebase-key",
    googleClientId: "test-client.apps.googleusercontent.com",
  }),
}));
let stored: Record<string, any>, launch: ReturnType<typeof vi.fn>;
const redirect = "https://fixture.chromiumapp.org/";
const sessionResponse = {
  idToken: "test-id-token",
  refreshToken: "test-refresh",
  expiresIn: "3600",
  displayName: "Viewer",
  email: "viewer@example.test",
};
beforeEach(() => {
  vi.resetModules();
  stored = {};
  launch = vi.fn(
    async ({ url }: { url: string }) =>
      `${redirect}#state=${new URL(url).searchParams.get("state")}&access_token=test-google-token`,
  );
  vi.stubGlobal("chrome", {
    identity: { getRedirectURL: () => redirect, launchWebAuthFlow: launch },
    storage: {
      session: {
        get: async () => structuredClone(stored),
        set: async (v: any) => {
          Object.assign(stored, structuredClone(v));
        },
        remove: async (k: string) => {
          delete stored[k];
        },
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(sessionResponse)),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("Google identity and Firebase session", () => {
  it("recognizes nested Google invalid-key diagnostics without exposing metadata", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json(
        {
          error: {
            message: "API key not valid. Please pass a valid API key.",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "API_KEY_INVALID",
                metadata: { credential: "must-not-expose" },
              },
            ],
          },
        },
        { status: 400 },
      ),
    );
    const error = await (
      await import("../src/background/auth")
    )
      .signIn()
      .catch((e) => e);
    expect(error.message).toContain("API_KEY_INVALID; HTTP 400");
    expect(error.message).toContain("rebuild");
    expect(error.message).not.toContain("must-not-expose");
    expect(stored.auth).toBeUndefined();
  });
  it("handles non-JSON provider failures with a safe status diagnostic", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("<html>private-error-detail</html>", { status: 502 }),
    );
    const error = await (
      await import("../src/background/auth")
    )
      .signIn()
      .catch((e) => e);
    expect(error.message).toContain("HTTP 502");
    expect(error.message).not.toContain("private-error-detail");
    expect(stored.auth).toBeUndefined();
  });
  it("gives actionable provider errors without exposing provider payloads or tokens", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json(
        {
          error: {
            message: "OPERATION_NOT_ALLOWED",
            detail: "private-provider-detail",
          },
        },
        { status: 400 },
      ),
    );
    await expect(
      (await import("../src/background/auth")).signIn(),
    ).rejects.toThrow("enable the Google provider");
    expect(stored.auth).toBeUndefined();
  });
  it("exchanges the Google token only after a valid callback and exposes only public identity", async () => {
    const auth = await import("../src/background/auth");
    expect(await auth.signIn()).toEqual({
      name: "Viewer",
      email: "viewer@example.test",
    });
    expect(await auth.user()).toEqual({
      name: "Viewer",
      email: "viewer@example.test",
    });
    const call = vi.mocked(fetch).mock.calls[0];
    expect(String(call[0])).toContain("accounts:signInWithIdp");
    expect(JSON.parse(call[1]!.body as string).postBody).toBe(
      "access_token=test-google-token&providerId=google.com",
    );
    expect(stored.auth.refreshToken).toBe("test-refresh");
  });
  it("rejects a forged state before exchanging tokens", async () => {
    launch.mockResolvedValue(
      `${redirect}#state=wrong&access_token=test-google-token`,
    );
    await expect(
      (await import("../src/background/auth")).signIn(),
    ).rejects.toThrow("state");
    expect(fetch).not.toHaveBeenCalled();
    expect(stored.auth).toBeUndefined();
  });
  it("rejects a callback at a different path", async () => {
    launch.mockImplementation(
      async ({ url }) =>
        `${redirect}unexpected#state=${new URL(url).searchParams.get("state")}&access_token=test`,
    );
    await expect(
      (await import("../src/background/auth")).signIn(),
    ).rejects.toThrow("callback");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("coalesces concurrent refreshes", async () => {
    stored.auth = {
      ...sessionResponse,
      user: { name: "Viewer", email: "viewer@example.test" },
      expiresAt: 0,
    };
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        id_token: "new-id",
        refresh_token: "new-refresh",
        expires_in: "3600",
      }),
    );
    const auth = await import("../src/background/auth");
    await Promise.all([auth.requireUser(), auth.requireUser()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(stored.auth.refreshToken).toBe("new-refresh");
  });
  it("does not let an in-flight refresh recreate a signed-out session", async () => {
    stored.auth = {
      ...sessionResponse,
      user: { name: "Viewer", email: "viewer@example.test" },
      expiresAt: 0,
    };
    let finish!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const auth = await import("../src/background/auth");
    const pending = expect(auth.requireUser()).rejects.toThrow("Sign in");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await auth.signOut();
    finish(
      Response.json({
        id_token: "late",
        refresh_token: "late",
        expires_in: "3600",
      }),
    );
    await pending;
    expect(stored.auth).toBeUndefined();
  });
  it("does not retain credentials when Firebase returns an error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json(
        { error: { message: "raw provider diagnostic" } },
        { status: 400 },
      ),
    );
    await expect(
      (await import("../src/background/auth")).signIn(),
    ).rejects.toThrow("See Sign-in help");
    expect(stored.auth).toBeUndefined();
  });
});
