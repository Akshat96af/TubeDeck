# Third-party notices

Original TubeDeck code is licensed under the MIT license in `LICENSE`. Dependencies retain their own licenses. A production build includes installed dependency versions and license texts in `licenses/DEPENDENCIES.md` and `licenses/`.

## Distill

Transcript UI fallbacks in `src/content/transcript.ts` were informed by and adapted from [Distill](https://github.com/jon-builds/distill), inspected at commit `4f02bd13f2cf9402452cdfd8337c56c77ee09da7`. The required notice follows.

MIT License

Copyright (c) 2026 Jonathan Cheung

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Runtime dependencies

- React, React DOM, scheduler, Zod, marked, and fflate retain their MIT license notices.
- idb and Lucide retain their ISC licenses and any additional notices in the bundled license texts.
- DOMPurify retains its Apache-2.0/MPL-2.0 dual-license text.
- Mediabunny retains its MPL-2.0 license. Its source is unmodified. The exact installed source form is supplied as `licenses/mediabunny-source.zip` in production distributions, together with the full license. Source and project information are also available at [Mediabunny](https://github.com/Vanilagy/mediabunny).

The original TubeDeck MIT license does not replace the license on third-party files. Build tooling reads the actual bundled dependency inputs to generate the distribution's license inventory.
