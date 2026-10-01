# TubeDeck

A YouTube companion for the things that make you pause: a new idea, an unfamiliar reference, a product, or an interesting discussion. Bring your own Gemini API key and activate AI for the current video when you want it.

TubeDeck is a Manifest V3 extension for desktop Chrome and compatible Chromium browsers. Its panel sits below the YouTube player and moves below the wide player in theatre mode. It uses React, TypeScript, and esbuild, with no hosted application backend.

**Status:** installable development build. Automated tests cover the AI gateway, cancellation, authentication, key storage, exports, and media container handling. Browser testing was explicitly skipped for this build. Live Google/Firebase/Gemini integration and playback of real YouTube downloads remain unverified. See [limitations](docs/LIMITATIONS.md).

## What you can do

- Activate a single video, get suggested starting points, and ask questions against its transcript with timestamp links.
- Make chronological notes in simple English; hover over transcript words, saved notes, or captions for brief explanations. Use Explain or Check for deeper context and web evidence.
- Ask about memes, jokes, references, and factual claims. Search evidence and uncertainty appear with results; a model answer is not independent proof.
- Capture the current frame, bookmark a moment, or start a transcript-guided visual note pass. Saved notes include actual images and editable text.
- Load accessible top-level comments, find keywords without an AI call, summarize reactions, or ask a question across retrieved comments. Replies are excluded; coverage stays visible.
- List visible objects on request, choose one to research, and open a Google or image-by-name search in the current browser. Uncertain product matches withhold shopping links.
- Enable paid sponsor detection separately for this video. Supported clear matches auto-skip; uncertain matches offer a Skip button.
- Change speed, set an A–B loop, hide recommendations/comments, and generate optional quizzes or flashcards.
- Copy a full or compact context capsule, or export a ZIP containing context and saved images. Capsules include completed research, chat, notes, sources, and comment coverage. Full capsules also include the transcript and retrieved comments.
- Save supported, directly exposed video/audio streams to one MP4 or WebM file, up to the actual available 2160p source. This is not a universal YouTube downloader; ciphered, protected, live, and unavailable sources are unsupported.

AI tasks start on the requested action, stream where appropriate, and offer Stop. Opening or navigating to a video does not generate AI requests. Stopping prevents further queued work; a provider may charge for work already processed.

## Build and load

Use Node.js 22.12+ or 24 LTS and npm. This build was checked with Node.js 24.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` (or your Chromium browser's extensions page).
2. Enable Developer mode, choose **Load unpacked**, and select the generated `dist` directory.
3. Open TubeDeck's Settings from its toolbar icon. Follow [setup](docs/SETUP.md) to configure Google/Firebase sign-in and enter your own Gemini key.
4. Reload an existing YouTube watch tab. Choose **Activate for this video** when ready. Activation reads the accessible transcript and makes one recommendation request.

No API keys or account credentials belong in source files. Firebase settings and the user's Gemini key are entered in the installed extension. Google sign-in does not grant Gemini API access automatically.

To create a distributable ZIP:

```sh
npm run package
```

This runs the non-browser checks and creates `releases/TubeDeck-0.1.0.zip` plus a SHA-256 file. Extract it to a stable folder and load that folder unpacked. Moving it may change its development extension ID and OAuth redirect URL. Packaging selects known build files; it never packages the repository, reference checkouts, private handoff documents, or local configuration wholesale.

## Development

| Command                 | Purpose                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`           | Rebuild JavaScript/CSS as source changes; reload the extension afterward               |
| `npm run typecheck`     | TypeScript validation                                                                  |
| `npm test`              | Unit and mocked integration tests; no browser launch                                   |
| `npm run verify`        | Types, tests, production build, credential-pattern scan                                |
| `npm run check:secrets` | Scan publishable repository files and built text assets without printing secret values |
| `npm run preview`       | Local fixture-only visual preview; AI and browser features are unavailable there       |

The existing `scripts/browser-test.mjs` is a development browser harness. It is not part of `test`, `verify`, or `package`, and was not run for this continuation.

`src/content` integrates with the YouTube page; `src/background` owns credentials, identity, AI requests, and tab sessions. `src/ui` contains the embedded panel, `src/settings` configures connections, and `src/download` streams media to the chosen file. Shared parsers and capsule creation live in `src/shared`.

Notes and screenshots persist locally. Conversations, loaded comments, research history, and activation are temporary per-video sessions. Export a capsule or save important results as notes before navigating away. See [privacy](PRIVACY.md) for storage and data flows.

## License

Original TubeDeck code is [MIT licensed](LICENSE). Dependency and adapted-code notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Production distributions include dependency license texts and the unmodified source of the MPL-licensed media library. TubeDeck is an independent project, not affiliated with YouTube or Google.
