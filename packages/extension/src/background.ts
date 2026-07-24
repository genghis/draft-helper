/**
 * Service worker: accumulates pick events from the content script (websocket
 * frames + DOM rescans), debounces, and pushes the full known set to the
 * Draft Helper API. Pushing everything each time keeps the pipeline
 * self-healing — the server writes are idempotent and manual marks always
 * win there, so at-least-once delivery is free.
 */

import { parseDraftFrame } from "@drafthelper/shared";
import { extApi, loadConfig, ExtApiError } from "./apiClient.js";

const PUSH_DEBOUNCE_MS = 1500;
const RETRY_BASE_MS = 5000;
const MAX_RETRY_MS = 60_000;

interface KnownPick {
  espnPlayerId: number;
  overall: number;
  teamId: number;
}

// In-memory state; a SW restart loses it, and the next rescan rebuilds it.
const known = new Map<number, KnownPick>();
let myTeamId = 0;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = RETRY_BASE_MS;
let dirty = false;

function addPick(espnPlayerId: number, teamId: number): void {
  if (known.has(espnPlayerId)) return;
  known.set(espnPlayerId, {
    espnPlayerId,
    overall: known.size + 1,
    teamId,
  });
  dirty = true;
}

function schedulePush(delay = PUSH_DEBOUNCE_MS): void {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), delay);
}

async function push(): Promise<void> {
  if (!dirty || known.size === 0) return;
  const config = await loadConfig();
  if (!config) {
    void setBadge("!", "#c0392b", "No token configured — open extension options");
    return;
  }
  try {
    const result = await extApi<{ written: number; skipped: number; unmapped: number[] }>(
      config,
      "/ext/picks",
      {
        method: "POST",
        body: { myTeamId, picks: Array.from(known.values()) },
      }
    );
    dirty = false;
    retryDelay = RETRY_BASE_MS;
    await chrome.storage.local.set({ lastPush: new Date().toISOString() });
    void setBadge(
      String(known.size),
      "#27ae60",
      `Synced ${known.size} picks (${result.unmapped.length} unmapped)`
    );
  } catch (err) {
    const message = err instanceof ExtApiError ? err.message : String(err);
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

interface FrameMessage {
  kind: "frame";
  frame: string;
  myTeamId: number;
}

interface RescanMessage {
  kind: "rescan";
  railIds: number[];
  rosterIds: number[];
  myTeamId: number;
}

chrome.runtime.onMessage.addListener((message: FrameMessage | RescanMessage) => {
  if (message.myTeamId > 0) myTeamId = message.myTeamId;

  if (message.kind === "frame") {
    for (const event of parseDraftFrame(message.frame)) {
      if (event.type === "pick") addPick(event.espnPlayerId, event.teamId);
    }
  } else if (message.kind === "rescan") {
    // Roster ids are the viewer's own picks; rail ids belong to unknown teams
    // (team 0 never equals a real myTeamId, so they come through as not-mine).
    for (const id of message.rosterIds) addPick(id, myTeamId);
    for (const id of message.railIds) addPick(id, 0);
  }

  if (dirty) schedulePush();
});
