/**
 * Fetch wrapper for the Draft Helper API from the extension service worker.
 * CloudFront's OAC signs request payloads, so every bodied request must carry
 * x-amz-content-sha256 (same trick as the web app's api client).
 */

const DEFAULT_BASE = "https://draft.clanseafox.com/api";

export interface ExtConfig {
  token: string;
  apiBase: string;
}

export async function loadConfig(): Promise<ExtConfig | null> {
  const stored = await chrome.storage.local.get(["token", "apiBase"]);
  const token = typeof stored.token === "string" ? stored.token : "";
  if (!token) return null;
  return {
    token,
    apiBase: typeof stored.apiBase === "string" && stored.apiBase ? stored.apiBase : DEFAULT_BASE,
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class ExtApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export async function extApi<T>(
  config: ExtConfig,
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.token}`,
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers["content-type"] = "application/json";
    headers["x-amz-content-sha256"] = await sha256Hex(body);
  }
  const res = await fetch(`${config.apiBase}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ExtApiError(res.status, detail?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
