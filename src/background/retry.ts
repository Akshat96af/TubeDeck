import { checkAbort, sleep } from "../shared/utils";

// Retry only rejected requests, never an answer that has begun streaming.
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  progress: (text: string) => void,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    checkAbort(signal);
    const response = await fetch(url, { ...init, signal });
    if (![502, 503, 504].includes(response.status) || attempt >= 2)
      return response;
    const retry = Number(response.headers.get("retry-after"));
    const delay = Math.min(
      10000,
      Math.max(1000 * 2 ** attempt, Number.isFinite(retry) ? retry * 1000 : 0),
    );
    await response.body?.cancel();
    progress(
      `Gemini is busy · retry ${attempt + 1}/2 in ${Math.ceil(delay / 1000)}s · Stop to cancel`,
    );
    await sleep(delay, signal);
  }
}
