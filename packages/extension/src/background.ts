/**
 * Service worker: accumulates pick events from the content script (websocket
 * frames + DOM rescans), debounces, and pushes the full known set to the
 * Draft Helper API. Pushing everything each time keeps the pipeline
 * self-healing — the server writes are idempotent and manual marks always
 * win there, so at-least-once delivery is free.
 *
 * MV3 service workers are killed after ~30s idle, so accumulated state lives
 * in chrome.storage.session (survives SW restarts within a browser session),
 * not a module-level variable that dies with the worker.
 */

import { parseDraftFrame } from "@drafthelper/shared";
import { extApi, loadConfig, ExtApiError } from "./apiClient.js";

const PUSH_DEBOUNCE_MS = 1500;
const RETRY_BASE_MS = 5000;
const MAX_RETRY_MS = 60_000;

const STATE_KEY = "draftState";

interface KnownPick {
  espnPlayerId: number;
  overall: number;
  teamId: number;
}

interface DraftState {
  myTeamId: number;
  /** Keyed by espnPlayerId (as string, since storage keys are strings). */
  picks: Record<string, KnownPick>;
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = RETRY_BASE_MS;

// Serializes read-modify-write of session state so burst frames (all-autopick
// drafts fire many at once) can't clobber each other's saves.
let stateQueue: Promise<void> = Promise.resolve();
function withState(fn: (state: DraftState) => boolean): Promise<void> {
  stateQueue = stateQueue.then(async () => {
    const state = await loadState();
    const changed = fn(state);
    if (changed) {
      await saveState(state);
      schedulePush();
    }
  });
  return stateQueue;
}

async function loadState(): Promise<DraftState> {
  const stored = await chrome.storage.session.get(STATE_KEY);
  return (stored[STATE_KEY] as DraftState | undefined) ?? { myTeamId: 0, picks: {} };
}

async function saveState(state: DraftState): Promise<void> {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

/**
 * Merges an observed pick into state. A real teamId (from a WS frame) always
 * upgrades a placeholder teamId 0 (from a DOM rescan), so "mine" attribution
 * is corrected even if the rescan saw the player first. Overall order is
 * assigned once, on first sighting, and never renumbered.
 */
function mergePick(state: DraftState, espnPlayerId: number, teamId: number): boolean {
  const key = String(espnPlayerId);
  const existing = state.picks[key];
  if (existing) {
    if (existing.teamId === 0 && teamId > 0) {
      existing.teamId = teamId;
      return true;
    }
    return false;
  }
  state.picks[key] = {
    espnPlayerId,
    overall: Object.keys(state.picks).length + 1,
    teamId,
  };
  return true;
}

function schedulePush(delay = PUSH_DEBOUNCE_MS): void {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), delay);
}

async function push(): Promise<void> {
  const state = await loadState();
  const picks = Object.values(state.picks);
  if (picks.length === 0) return;
  const config = await loadConfig();
  if (!config) {
    void setBadge("!", "#c0392b", "No token configured — open extension options");
    return;
  }
  try {
    const result = await extApi<{ written: number; skipped: number; unmapped: number[] }>(
      config,
      "/ext/picks",
      { method: "POST", body: { myTeamId: state.myTeamId, picks } }
    );
    retryDelay = RETRY_BASE_MS;
    await chrome.storage.local.set({ lastPush: new Date().toISOString() });
    void setBadge(
      String(picks.length),
      "#27ae60",
      `Synced ${picks.length} picks (${result.unmapped.length} unmapped)`
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
  // No response is sent, so don't return true / keep the channel open; the
  // serialized state update runs detached.
  void withState((state) => {
    let changed = false;
    if (message.myTeamId > 0 && state.myTeamId !== message.myTeamId) {
      state.myTeamId = message.myTeamId;
      changed = true;
    }
    if (message.kind === "frame") {
      for (const event of parseDraftFrame(message.frame)) {
        if (event.type === "pick") {
          changed = mergePick(state, event.espnPlayerId, event.teamId) || changed;
        }
      }
    } else {
      // Roster ids are the viewer's own picks; rail ids belong to other teams
      // (teamId 0 = unknown, upgraded later if a WS frame names the team).
      for (const id of message.rosterIds) {
        changed = mergePick(state, id, state.myTeamId || 0) || changed;
      }
      for (const id of message.railIds) {
        changed = mergePick(state, id, 0) || changed;
      }
    }
    return changed;
  });
});
