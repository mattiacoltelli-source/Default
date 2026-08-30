const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch con timeout, retry ed exponential backoff + jitter.
 * Ritenta su timeout/errore di rete/429/5xx. Fallisce subito (no retry) su altri 4xx,
 * perche' indicano un errore di richiesta e non un problema temporaneo.
 */
export async function fetchWithRetry(url, options = {}) {
  const {
    retries = 3,
    baseDelayMs = 500,
    timeoutMs = 15000,
    headers = {},
    ...fetchOptions
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...fetchOptions,
        headers: { ...DEFAULT_HEADERS, ...headers },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) return res;

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === retries) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `HTTP ${res.status} ${res.statusText} per ${url}${body ? ` — ${body.slice(0, 300)}` : ""}`,
        );
      }
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt === retries) throw err;
    }

    const backoff = baseDelayMs * 2 ** attempt;
    const jitter = Math.random() * baseDelayMs;
    await sleep(backoff + jitter);
  }
  throw lastError ?? new Error(`Fetch fallita per ${url}`);
}

/**
 * Rate limiter sequenziale per host: garantisce un delay minimo tra richieste
 * consecutive verso lo stesso client (uso: un'istanza per host).
 */
export class RateLimiter {
  constructor(minDelayMs) {
    this.minDelayMs = minDelayMs;
    this.lastCallAt = 0;
  }

  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastCallAt;
    const jitter = Math.random() * this.minDelayMs * 0.3;
    const waitMs = this.minDelayMs + jitter - elapsed;
    if (waitMs > 0) await sleep(waitMs);
    this.lastCallAt = Date.now();
  }
}

export { sleep };
