# Build scope and validation limits

This document separates implemented paths from live behavior that still needs verification. Browser testing was skipped at the user's explicit request. Automated tests use mocked API responses, fake Chrome APIs, parser fixtures, and synthetic encoded media packets; they do not establish live YouTube compatibility, Google OAuth configuration, Gemini answer quality, or playable 4K output.

## External integrations

- Google/Firebase sign-in requires the installer's project configuration. No real credentials were supplied for this build, and no live sign-in was performed.
- Gemini requires the user's key. The test suite checks request construction, streaming, evidence metadata, batching, quota failures, and cancellation without paid API calls.
- YouTube changes its page structure. Transcript and comment retrieval depend on accessible DOM elements. Missing/localized transcript controls may require opening the transcript manually or pasting one.
- The normal/theatre layout placement, native caption hover, visual capture, and animations are implemented but not validated in a real browser during this continuation.

## Downloads

TubeDeck reads formats exposed by the current player and accepts direct HTTPS URLs on `*.googlevideo.com`. It combines compatible encoded audio/video into MP4 or WebM using Mediabunny, streaming writes to a user-selected file. It neither re-encodes nor upscales, and only offers a video when an audio path is available.

It does not decipher player signatures, bypass protected media, obtain missing authorization, process livestreams, or fetch unavailable formats. A displayed source may still expire or be rejected by YouTube. Consequently, 2160p is possible only when usable source tracks are actually exposed; universal 4K or IDM-level download compatibility is **not established**. There is no download queue, scheduled downloader, or pause/resume manager in this build. Failed/cancelled writes are aborted, although the file picker may leave an empty newly-created placeholder.

The media test generates and remuxes synthetic packets, verifies both tracks and timestamps, and checks close/abort behavior. It does not decode those packets or test audiovisual playback.

## Evidence and completeness

- “Reached the end” refers to YouTube's accessible transcript or comments in the selected sort, not hidden/deleted/filtered content. Comment replies are excluded. Exact repeated entries are deduplicated; conflicting opinions remain. Large comment sets use batches and intermediate reports, with partial coverage disclosed.
- Full transcript text is used for detailed Q&A. Inputs beyond the application guard fail visibly instead of being silently truncated; the model may enforce a lower limit. There is no audio transcription fallback or fine-tuning. Each request supplies context to an existing model.
- Timestamp links come from model output and may still be wrong. Sponsor auto-skip additionally requires transcript boundaries and an explicit paid-disclosure phrase. Its conservative disclosure matcher currently recognizes English; other languages and ambiguous boundaries use manual suggestions.
- A visual note pass samples at most four transcript-selected frames per action. It does not continuously watch the video or detect every diagram. Some videos block canvas capture; restoring playback can fail if navigation or the player changes.
- Fact checks and reference explanations use provider search evidence when returned. There is no direct Reddit API integration or independent verifier. Missing evidence is not proof that a claim is false.
- Product identification is an AI judgment from the selected frame/transcript and search evidence. Uncertain matches withhold source shopping links and offer a name-based Google search. Image search opens a textual object query; it is **not reverse-image matching** or an integrated Google Lens upload.

## Session and storage

AI activation resets on navigation. Saved notes and screenshots persist in the extension database, associated with their video; revisit the video to see them. Chat, research, retrieved comments, and transcript context live in the background worker's memory and may disappear on restart. Export a capsule or save a note for anything you want to retain. There is no cloud sync or cross-device history.

Stop cancels fetches and further queued work. It cannot undo provider work or guarantee a refund. The displayed token count covers usage reported by completed requests; interrupted or failed multi-step tasks can incur additional usage. Large comment sets can be expensive despite batching.

## Before a public release

With browser testing authorized and project configuration available, verify installation and permissions, Google login/logout, live Gemini text/image/search, real navigation and theatre transitions, long/missing transcripts, comment cancellation, capture restoration, and playback of successful downloads with audio synchronization. Then review the current Chrome Web Store distribution requirements and privacy disclosures. This build has not been submitted to a store or deployed.
