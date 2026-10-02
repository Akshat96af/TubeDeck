# Configure TubeDeck

Users of a configured release only sign in with Google and enter their own Gemini key. Firebase belongs to the TubeDeck maintainer and is configured once at build time.

## Maintainer build configuration

Copy `app-config.example.json` to `app-config.local.json` in the project root. Fill in `firebaseApiKey` with the Firebase project's Web API key and `googleClientId` with the same project's Google OAuth **Web application** client ID. Run `npm run package`, then reload the extension from `dist` in `chrome://extensions` (or `brave://extensions`). Close and reopen its settings page.

`app-config.local.json` is ignored by Git. The build copies only these two validated public identifiers into `dist/app-config.json`; packaging includes that generated file. Unknown fields are rejected. Never put a Gemini key, OAuth client secret, service-account credential, or any future paid-service secret in this file. Changing the local configuration requires rebuilding, including during watch mode.

Firebase Web API keys identify the Firebase project and are intentionally visible in distributed clients. They do not authorize access to protected backend resources. Keep future shared provider secrets on the server and enforce authentication and quotas there. See [Firebase API keys](https://firebase.google.com/docs/projects/api-keys). The repository scanner permits the exact configured Firebase identifier only in this generated asset; it still scans source files and all other build assets for keys.

## Google sign-in with Firebase

1. Create or choose a Firebase project. Enable **Authentication → Sign-in method → Google** and configure the project support email.
2. In the same Google Cloud project, configure the OAuth consent screen. Add your Google account as a test user while the OAuth application is in testing.
3. Use a **Web application** OAuth client associated with that project. In Google Cloud Console → **Google Auth Platform → Clients** (or APIs & Services → Credentials), open the client whose ID you placed in the local build configuration. Open TubeDeck Settings → **Sign-in help** and copy the exact **OAuth redirect URL**. Add that URL, including the trailing slash, to the client's **Authorized redirect URIs**, then save. It has the form `https://YOUR_EXTENSION_ID.chromiumapp.org/`. It belongs in redirect URIs, not JavaScript origins.
4. In Firebase Authentication's authorized domains, add the corresponding `YOUR_EXTENSION_ID.chromiumapp.org` hostname. Keep the Google provider and OAuth client configuration aligned with the same project; if you select an existing Google provider web client, edit that client's redirect URIs.
5. Set the OAuth app's public name to TubeDeck and provide the support email. Save the Google provider in Firebase. Under Google Auth Platform → Audience, add your account as a test user if the app is in testing. After saving the console changes, click **Sign in with Google** in TubeDeck.

Users do not enter or edit Firebase identifiers in the extension. The Gemini key is separate from this maintainer configuration. No Firebase Hosting deployment or Firebase CLI installation is needed just for sign-in. If the Firebase Web API key has API restrictions, retain the Firebase Authentication APIs it needs (Identity Toolkit and Secure Token); do not use a Gemini-only key for Firebase. Check browser application restrictions against the extension before release.

The implementation opens a user-initiated Google OAuth flow, validates callback origin/path and state, then exchanges the Google access token through Firebase's `accounts:signInWithIdp` endpoint. Firebase tokens stay in extension session storage. See [Chrome identity](https://developer.chrome.com/docs/extensions/reference/api/identity#method-launchWebAuthFlow) and the [Firebase Auth REST reference](https://firebase.google.com/docs/reference/rest/auth#section-sign-in-with-oauth-credential).

An unpacked extension's ID can change when its location changes. Always register the URL displayed by the copy you are actually loading. A store release needs its own stable extension ID, redirect registration, consent configuration, and release validation.

## Gemini

1. Create your own key in [Google AI Studio](https://aistudio.google.com/apikey).
2. Paste it into **Your Gemini connection** in TubeDeck Settings. Keep **Remember my key** unchecked to use browser-session storage; check it only if you want persistence in this browser profile.
3. Save the connection. **Load available models** queries your API project without generating an answer; you can cancel it.
4. Choose a model available to your project that supports text, images, and Google Search grounding. The default is `gemini-flash-latest`. Some models returned by Google's list may not support every feature. Model availability, quotas, and any charges depend on your project.
5. Open a YouTube watch page and activate that video. Sign-in alone does not supply a Gemini key or API quota.

TubeDeck calls Google's REST API directly using the user's key in the `x-goog-api-key` header. Grounded Explain, Check, and product research requests make Google's search tool available to the model. The model may return no web evidence; TubeDeck labels that case. Provider search suggestions are displayed when returned. See [Gemini content generation](https://ai.google.dev/gemini-api/docs/text-generation) and [Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search).

## First-use flows

- **Transcript:** activation attempts YouTube's visible transcript. If unavailable, open YouTube's Show transcript panel and retry, or paste text in TubeDeck's Transcript tab. Both `[0:12] text` and a timestamp on a separate line are supported. Unknown timing stays unknown.
- **Comments:** click Load comments to scroll through accessible top-level comments in the selected YouTube sort. Stop preserves what was retrieved. Keyword finding is local; Summarize and Ask use Gemini.
- **Screenshots:** allow the video frame to load, then capture it. The visual note pass seeks to transcript-selected moments and restores playback. Protected frames or ads can prevent capture.
- **Downloads:** open the download view and explicitly enable access to YouTube's video-source host. Choose an offered format and a file destination. Keep the source video open. This uses a browser file picker and needs a compatible desktop Chromium browser; Stop aborts unfinished file writes.
- **Capsule:** copy full context, copy compact context, or save a ZIP with actual saved images. Plain clipboard text cannot attach images.

## Troubleshooting

| Symptom                                 | Action                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Google redirect mismatch                | Register the exact Settings redirect URL on the same web OAuth client ID                                                          |
| Sign-in rejected or access denied       | Check the enabled Firebase Google provider, client/project match, consent test users, and Firebase/Google API restrictions        |
| Sign-in expired                         | Sign in again; closing the browser clears session credentials                                                                     |
| Gemini quota/429                        | Wait for your provider quota to reset or adjust your own API project; TubeDeck does not automatically retry chargeable generation |
| Unsupported model/search                | Select another compatible model available to your key                                                                             |
| Transcript unavailable                  | Open YouTube's transcript manually or paste a transcript; translated/localized layouts may need this fallback                     |
| Comments partial                        | YouTube may filter, hide, or stop loading comments. Analyze the reported coverage rather than treating it as every viewer         |
| No downloadable formats or 403          | Reload the source video and refresh formats. Protected/ciphered/expired URLs can remain unavailable                               |
| Extension reloaded while a tab was open | Reload the YouTube tab to reconnect the content script                                                                            |

There is no hosted proxy or developer-funded Gemini service in this version. Google sign-in gates the packaged client, but a modified open-source client can remove that gate. Before introducing paid backend resources, enforce identity, quotas, and authorization on that backend. No Firebase database, storage bucket, or cloud functions deployment is required for this local BYOK design.
