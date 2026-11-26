import "server-only";

/** `fetch` failed before any HTTP response: DNS, TCP reset, TLS (e.g. an intercepting firewall). */
export class NetworkError extends Error {
  constructor(public host: string, public causeCode: string) {
    super(`network_error ${host} ${causeCode}`);
    this.name = "NetworkError";
  }
}

const TLS_CODES = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/;

/**
 * `fetch` that retries once after a network-level failure (not on HTTP errors or
 * timeouts), and turns the opaque "TypeError: fetch failed" into a NetworkError
 * that names the host and the underlying cause code.
 */
export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (!(e instanceof TypeError)) throw e; // AbortError / TimeoutError pass through
      const cause = (e as TypeError & { cause?: { code?: string; message?: string } }).cause;
      const code = cause?.code ?? cause?.message?.slice(0, 60) ?? "unknown";
      // A TLS verification failure won't fix itself in 400 ms; don't retry it.
      if (attempt >= 1 || TLS_CODES.test(code)) {
        console.warn(`[net] ${host} unreachable: ${code}${TLS_CODES.test(code) ? " (TLS: is a firewall intercepting HTTPS?)" : ""}`);
        throw new NetworkError(host, code);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}
