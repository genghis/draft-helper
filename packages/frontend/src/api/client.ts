/**
 * Same-origin API client. CloudFront fronts the Lambda with an Origin Access
 * Control that SigV4-signs requests; for requests WITH a body, CloudFront
 * requires the client to supply the payload hash in x-amz-content-sha256
 * (CloudFront does not buffer bodies to hash them itself).
 */
async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
    headers["x-amz-content-sha256"] = await sha256Hex(body);
  }
  const res = await fetch(`/api${path}`, { method: options.method ?? "GET", headers, body });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
