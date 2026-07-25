/**
 * Isolated-world content script. This is the reliable accumulation point:
 * unlike the MV3 service worker (killed after ~30s idle), a content script
 * lives for the whole tab, so it holds the complete pick set for the draft
 * and sends a full cumulative snapshot to the worker on every change. Any
 * single snapshot that reaches the worker conveys everything, so a dropped
 * message during worker wake/suspend is harmless.
 *
 * Sources feeding the accumulator:
 *  - websocket SELECTED frames (from the MAIN-world wrapper) — complete and
 *    ordered, carries the real teamId (drives "mine").
 *  - a periodic DOM rescan of the pick rail — a catch-up net for a late join
 *    or a missed frame. ESPN virtualizes the rail (only ~10 rows rendered),
 *    so this alone is never complete; it only supplements the frames.
 */

import { parseDraftFrame } from "@drafthelper/shared";

const RELAY_TYPE = "__drafthelper_ws_frame";
const RESCAN_MS = 20_000;
const HEARTBEAT_MS = 10_000;
const SNAPSHOT_DEBOUNCE_MS = 800;
const HEADSHOT_ID = /players\/full\/(-?\d+)\./;
/** Pick-rail rows read like "Jahmyr Gibbs / DET RB — R1, P1 - Team 3". */
const PICK_ROW_TEXT = /R\d+,\s*P\d+/;

const myTeamId = Number(new URLSearchParams(window.location.search).get("teamId") ?? 0);

interface KnownPick {
  espnPlayerId: number;
  teamId: number;
  overall: number;
}

const picks = new Map<number, KnownPick>();
let snapshotTimer: ReturnType<typeof setTimeout> | undefined;

/** Adds/updates a pick; a real teamId upgrades a placeholder 0. Returns true if changed. */
function record(espnPlayerId: number, teamId: number): boolean {
  const existing = picks.get(espnPlayerId);
  if (existing) {
    if (existing.teamId === 0 && teamId > 0) {
      existing.teamId = teamId;
      return true;
    }
    return false;
  }
  picks.set(espnPlayerId, { espnPlayerId, teamId, overall: picks.size + 1 });
  return true;
}

function sendSnapshot(): void {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    try {
      // sendMessage rejects (not throws) when the worker is gone; swallow it so
      // it isn't an unhandled rejection. The next snapshot carries the same data.
      void chrome.runtime.sendMessage({
        kind: "snapshot",
        myTeamId,
        picks: Array.from(picks.values()),
      })?.catch?.(() => {});
    } catch {
      // Extension context invalidated (reload) — nothing to do.
    }
  }, SNAPSHOT_DEBOUNCE_MS);
}

window.addEventListener("message", (ev: MessageEvent) => {
  // Only trust same-window, same-origin posts from our MAIN-world relay, so a
  // co-running page script can't inject synthetic frames.
  if (ev.source !== window || ev.origin !== window.location.origin) return;
  const data = ev.data as { type?: string; frame?: string } | null;
  if (data?.type !== RELAY_TYPE || typeof data.frame !== "string") return;
  let changed = false;
  for (const event of parseDraftFrame(data.frame)) {
    if (event.type === "pick") changed = record(event.espnPlayerId, event.teamId) || changed;
  }
  if (changed) sendSnapshot();
});

function isPickRow(img: HTMLImageElement): boolean {
  let el: HTMLElement | null = img.parentElement;
  for (let depth = 0; el && depth < 5; depth++, el = el.parentElement) {
    const text = el.textContent ?? "";
    if (text.length < 200 && PICK_ROW_TEXT.test(text)) return true;
  }
  return false;
}

/**
 * Catch-up scan of rendered pick rows. It records ids with teamId 0 (unknown)
 * only — it never guesses "mine" from a roster panel, because that guess can
 * mis-attribute an opponent's pick. WebSocket SELECTED frames carry the real
 * teamId and are the sole source of "mine"; the server refuses to downgrade a
 * mine=true, so a rescan can only fill gaps, never un-flag your picks.
 */
function rescan(): void {
  let changed = false;
  for (const img of Array.from(document.querySelectorAll<HTMLImageElement>("img"))) {
    const match = HEADSHOT_ID.exec(img.src);
    if (!match) continue;
    const id = Number(match[1]);
    if (!Number.isFinite(id)) continue;
    if (isPickRow(img)) changed = record(id, 0) || changed;
  }
  if (changed) sendSnapshot();
}

window.addEventListener("load", () => {
  // ESPN team ids are 1-based; 0 means we couldn't read `teamId` from the URL,
  // so nothing would ever be flagged as the user's own pick. Warn rather than
  // sync silently with broken "mine" attribution.
  if (!(myTeamId > 0)) {
    try {
      void chrome.runtime
        .sendMessage({ kind: "warn", text: "Couldn't detect your team — picks won't be flagged as yours." })
        ?.catch?.(() => {});
    } catch {
      /* extension reloading */
    }
  }
  setTimeout(rescan, 5_000);
  setInterval(rescan, RESCAN_MS);
  // Heartbeat: re-send the current snapshot so a push lost to a worker
  // suspend/restart (e.g. the very last pick) still eventually lands.
  setInterval(() => {
    if (picks.size > 0) sendSnapshot();
  }, HEARTBEAT_MS);
});

export {};
