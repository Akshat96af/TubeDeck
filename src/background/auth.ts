import { getSettings } from "./storage";
import type { PublicUser } from "../shared/types";
interface AuthRecord {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
  user: PublicUser;
}
let identityGeneration = 0;
let refreshInFlight: Promise<PublicUser> | undefined;
// Serialize session mutations so a late refresh cannot restore a signed-out
// account or remove a newer successful sign-in.
let authMutation: Promise<void> = Promise.resolve();
function mutateAuth(fn: () => Promise<void>): Promise<void> {
  const task = authMutation.then(fn, fn);
  authMutation = task.catch(() => {});
  return task;
}
async function storeAuth(record: AuthRecord, generation: number) {
  await mutateAuth(async () => {
    if (generation !== identityGeneration) throw new Error("Sign-in changed.");
    await chrome.storage.session.set({ auth: record });
  });
  if (generation !== identityGeneration) throw new Error("Sign-in changed.");
}
async function authRequest(
  url: string,
  body: object | URLSearchParams,
): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":
        body instanceof URLSearchParams
          ? "application/x-www-form-urlencoded"
          : "application/json",
    },
    body: body instanceof URLSearchParams ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const messages: Record<string, string> = {
      OPERATION_NOT_ALLOWED:
        "Google sign-in is disabled for TubeDeck. The maintainer must enable the Google provider in Firebase Authentication.",
      UNAUTHORIZED_DOMAIN:
        "This extension's callback domain is not authorized. The maintainer must register the hostname shown under Sign-in help in Firebase Authentication.",
      INVALID_API_KEY:
        "The Firebase web API key in this build is invalid. The maintainer must update the local app configuration, rebuild, and reload TubeDeck.",
      API_KEY_INVALID:
        "The Firebase web API key in this build is invalid. The maintainer must update the local app configuration, rebuild, and reload TubeDeck.",
      API_KEY_HTTP_REFERRER_BLOCKED:
        "The Firebase key's website restrictions blocked this extension. The maintainer must review its application restrictions in Google Cloud.",
      API_KEY_SERVICE_BLOCKED:
        "The Firebase key is not allowed to call this authentication API. The maintainer must check its Identity Toolkit and Token Service API restrictions.",
      SERVICE_DISABLED:
        "The required authentication API is disabled. The maintainer must check the project's enabled APIs.",
      CONFIGURATION_NOT_FOUND:
        "Firebase Authentication is not configured for the project associated with this key. The maintainer must check the project and enable Google sign-in.",
      INVALID_IDP_RESPONSE:
        "Google and Firebase could not verify this sign-in. The maintainer should check that the OAuth client and Google provider use the same Firebase project.",
      TOO_MANY_ATTEMPTS_TRY_LATER:
        "Too many sign-in attempts. Wait a little before trying again.",
      USER_DISABLED:
        "This account has been disabled for TubeDeck. Contact the maintainer.",
    };
    // Google gateway errors use ErrorInfo.reason; Firebase errors often use a
    // message code. Only show recognized codes and our text, never raw payloads.
    const details = Array.isArray(result?.error?.details)
      ? result.error.details
      : [];
    const codes: unknown[] = details
      .filter(
        (detail: any) =>
          detail?.["@type"] === "type.googleapis.com/google.rpc.ErrorInfo",
      )
      .map((detail: any) => detail.reason);
    if (typeof result?.error?.message === "string")
      codes.push(
        /^([A-Z][A-Z_0-9]*)(?:\s*:|$)/.exec(result.error.message)?.[1],
      );
    const code = codes.find(
      (candidate): candidate is string =>
        typeof candidate === "string" && Object.hasOwn(messages, candidate),
    );
    throw new Error(
      code
        ? `${messages[code]} (${code}; HTTP ${response.status})`
        : `Google sign-in could not be completed (Firebase HTTP ${response.status}). Check the app's Google provider, OAuth callback registration, and Firebase API restrictions. See Sign-in help.`,
    );
  }
  if (!result || typeof result !== "object")
    throw new Error(
      "Firebase returned an unreadable authentication response. Try again.",
    );
  return result;
}
export async function user(): Promise<PublicUser | undefined> {
  const record = (await chrome.storage.session.get("auth")).auth as
    AuthRecord | undefined;
  return record?.user;
}
export async function requireUser(): Promise<PublicUser> {
  const generation = identityGeneration;
  const record = (await chrome.storage.session.get("auth")).auth as
    AuthRecord | undefined;
  if (!record) throw new Error("Sign in with Google before activating AI.");
  if (generation !== identityGeneration)
    throw new Error("Sign-in changed. Try again.");
  if (record.expiresAt < Date.now() + 60000) {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = refreshRecord(record, generation);
    const task = refreshInFlight;
    try {
      return await task;
    } finally {
      if (refreshInFlight === task) refreshInFlight = undefined;
    }
  }
  return record.user;
}
async function refreshRecord(
  record: AuthRecord,
  generation: number,
): Promise<PublicUser> {
  const settings = await getSettings();
  try {
    const r = await authRequest(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(settings.firebaseApiKey)}`,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: record.refreshToken,
      }),
    );
    if (generation !== identityGeneration) throw new Error("Sign-in changed.");
    if (
      !r.id_token ||
      !r.refresh_token ||
      !Number.isFinite(Number(r.expires_in))
    )
      throw new Error("Invalid refreshed session.");
    record.idToken = r.id_token;
    record.refreshToken = r.refresh_token;
    record.expiresAt = Date.now() + Number(r.expires_in) * 1000;
    await storeAuth(record, generation);
  } catch {
    if (generation === identityGeneration) await signOut();
    throw new Error("Your sign-in expired. Sign in with Google again.");
  }
  return record.user;
}
export async function signIn(): Promise<PublicUser> {
  const generation = ++identityGeneration;
  const s = await getSettings();
  if (!s.firebaseApiKey || !s.googleClientId)
    throw new Error(
      "Google sign-in is not configured in this build. The maintainer must include the Firebase app configuration.",
    );
  const redirect = chrome.identity.getRedirectURL();
  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: s.googleClientId,
    redirect_uri: redirect,
    response_type: "token",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();
  const result = await chrome.identity.launchWebAuthFlow({
    url: url.href,
    interactive: true,
  });
  if (!result) throw new Error("Sign-in was cancelled.");
  const callback = new URL(result);
  if (
    callback.origin !== new URL(redirect).origin ||
    callback.pathname !== new URL(redirect).pathname
  )
    throw new Error("Unexpected sign-in callback.");
  const params = new URLSearchParams(callback.hash.slice(1));
  if (params.get("state") !== state)
    throw new Error("Sign-in state did not match. Try again.");
  if (params.get("error") === "access_denied")
    throw new Error(
      "Google sign-in was declined. If the app is in testing, the maintainer must add your Google account as a test user.",
    );
  const token = params.get("access_token");
  if (!token) throw new Error("Google did not return an access token.");
  const data = await authRequest(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(s.firebaseApiKey)}`,
    {
      postBody: new URLSearchParams({
        access_token: token,
        providerId: "google.com",
      }).toString(),
      requestUri: redirect,
      returnSecureToken: true,
      returnIdpCredential: false,
    },
  );
  if (
    !data.idToken ||
    !data.refreshToken ||
    !Number.isFinite(Number(data.expiresIn))
  )
    throw new Error("Firebase did not return a valid session.");
  const record: AuthRecord = {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn) * 1000,
    user: {
      name: data.displayName || "YouTube viewer",
      email: data.email || "",
    },
  };
  if (generation !== identityGeneration)
    throw new Error("Sign-in was cancelled.");
  await storeAuth(record, generation);
  return record.user;
}
export async function signOut() {
  identityGeneration++;
  refreshInFlight = undefined;
  await mutateAuth(() => chrome.storage.session.remove("auth"));
}
