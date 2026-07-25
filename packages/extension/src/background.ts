/**
 * Service worker: a thin, stateless forwarder. The content script accumulates
 * the complete pick set (it outlives this worker) and sends a full cumulative
 * snapshot on every change, so the worker just pushes whatever it last
 * received to the API. Server writes are idempotent and manual marks always
 * win there, so re-pushing the full set is free and self-healing.
 */

import { extApi, loadConfig, ExtApiError } from "./apiClient.js";

const PUSH_DEBOUNCE_MS = 800;
const RETRY_BASE_MS = 4000;
const MAX_RETRY_MS = 60_000;

interface SnapshotPick {
  espnPlayerId: number;
  teamId: number;
  overall: number;
}

interface SnapshotMessage {
  kind: "snapshot";
  myTeamId: number;
  picks: SnapshotPick[];
}

interface WarnMessage {
  kind: "warn";
  text: string;
}

// Latest snapshot to push; overwritten by each newer one (they're cumulative).
let latest: SnapshotMessage | null = null;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = RETRY_BASE_MS;

function schedulePush(delay = PUSH_DEBOUNCE_MS): void {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), delay);
}

async function push(): Promise<void> {
  const snapshot = latest;
  if (!snapshot || snapshot.picks.length === 0) return;
  const config = await loadConfig();
  if (!config) {
    void setBadge("!", "#c0392b", "No token configured — open extension options");
    return;
  }
  try {
    const result = await extApi<{ written: number; skipped: number; unmapped: number[] }>(
      config,
      "/ext/picks",
      { method: "POST", body: { myTeamId: snapshot.myTeamId, picks: snapshot.picks } }
    );
    retryDelay = RETRY_BASE_MS;
    await chrome.storage.local.set({ lastPush: new Date().toISOString() });
    void setBadge(
      String(snapshot.picks.length),
      "#27ae60",
      `Synced ${snapshot.picks.length} picks (${result.unmapped.length} unmapped)`
    );
  } catch (err) {
    const message = err instanceof ExtApiError ? err.message : String(err);
    // Auth/validation failures won't fix themselves — stop retrying and tell the
    // user to reconnect, rather than looping forever (re-armed every heartbeat).
    const status = err instanceof ExtApiError ? err.status : 0;
    if (status === 400 || status === 401 || status === 403) {
      void setBadge("!", "#c0392b", `Reconnect token — ${message}`);
      return;
    }
    void setBadge("!", "#c0392b", `Push failed: ${message}`);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
    schedulePush(retryDelay);
  }
}

async function setBadge(text: string, color: string, title: string): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setTitle({ title: `Draft Helper Sync — ${title}` });
  } catch {
    // Badge is cosmetic.
  }
}

chrome.runtime.onMessage.addListener((message: SnapshotMessage | WarnMessage) => {
  if (message?.kind === "warn") {
    void setBadge("?", "#b9770e", message.text);
    return;
  }
  if (message?.kind !== "snapshot") return;
  latest = message;
  schedulePush();
});
