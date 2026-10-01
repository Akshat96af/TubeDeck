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
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      "Google sign-in could not be completed. Check the Firebase project, enabled Google provider, OAuth client, and redirect URL in settings.",
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
      "Complete the Firebase and Google OAuth configuration in settings first.",
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
