# TubeDeck privacy and data handling

This describes the code in this repository. TubeDeck has no analytics, advertising, cloud sync, or hosted application server. It uses Google services when you request identity or AI features.

## Stored in your browser

| Data                                                                     | Location and lifetime                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Gemini API key                                                           | Extension session storage by default; local storage only if Remember my key is enabled |
| Firebase ID/refresh tokens and account name/email                        | Extension session storage; cleared on sign-out or browser-session end                  |
| Model, Firebase web API key, OAuth client ID, key persistence preference | Extension local storage until changed or the extension is removed                      |
| Saved notes, screenshots, bookmarks, quizzes/flashcards saved as notes   | Extension IndexedDB until deleted or the extension is removed                          |
| Transcript, chat, research, comments, activation, token count            | Temporary per-tab video session in the background service worker                       |

Chrome storage access is restricted to trusted extension contexts. The content script and YouTube page are not given the user's Gemini key or Firebase tokens. Remembered keys are not encrypted by a TubeDeck vault; someone who can access the browser profile may be able to read them.

## Data sent outside your browser

- **Google sign-in and Firebase Authentication:** user-initiated OAuth sign-in exchanges a Google token for a Firebase session. Google/Firebase process account and authentication data under their own terms.
- **Gemini API:** requested AI actions send the video title/channel, relevant transcript context, user question/selection, and conversation history where applicable. Comment analysis sends retrieved public comment text, author names, IDs, and coverage. Visual analysis sends the captured frame. Requests use your API key and selected model.
- **Google Search grounding:** Explain, Check, and product research may use the Gemini search tool. Google determines search execution; citations and search suggestions are displayed when supplied. TubeDeck does not automatically research each video before activation.
- **External links:** clicking source, product-search, or image-by-name links opens the selected site in your current browser. Name-based image search does not upload a screenshot.
- **Video downloads:** on explicit permission and a format choice, media bytes are requested directly from the Google video-source host and written to the file you select.

Use your Google account/API project settings and Google's service policies to understand provider retention and model data handling. TubeDeck does not control what those providers retain.

## Control and deletion

AI stays off until you activate the current video. Stop cancels ongoing requests and further work where possible. Navigation disables activation; paid sponsor skipping needs its own switch. Comment loading, object listing, and visual note passes start only on request.

Remove the Gemini key in Settings, sign out to remove the Firebase session, and delete saved notes individually. Clear conversation removes the current chat. Uninstalling the extension removes its browser-managed storage; previously downloaded files and copied/exported capsules remain wherever you saved them. Signing out does not delete your Firebase account; the Firebase project maintainer can manage that account through the project's Authentication console.

Capsules deliberately omit configuration, API keys, and account tokens. They include video context, your chat/research/notes, public comments in full exports, and saved images in ZIP exports. Review them before sharing. Text you manually paste into a note or conversation will be included as ordinary content.

## Permissions

| Permission                        | Purpose                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `storage`                         | User configuration and session credentials                                             |
| `identity`                        | User-initiated Google sign-in callback                                                 |
| `scripting` on YouTube            | Read player-exposed download format information                                        |
| `clipboardWrite`                  | Copy the requested context capsule                                                     |
| YouTube host                      | Place the panel, read accessible transcript/comments, control playback, capture frames |
| Gemini and Firebase hosts         | User-requested AI and authentication                                                   |
| Optional `*.googlevideo.com` host | Read supported media streams only after download access is enabled                     |

All application JavaScript is bundled locally. Provider search-attribution markup is sanitized before display and is not executed as code.
