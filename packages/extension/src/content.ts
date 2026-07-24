/**
 * Isolated-world content script: relays websocket frames from the MAIN-world
 * wrapper to the service worker, and periodically re-scans the draft room DOM
 * as a catch-up/fallback path (late join, service-worker restart, or a missed
 * frame). Pick rows expose ESPN player ids via headshot image URLs.
 */

const RELAY_TYPE = "__drafthelper_ws_frame";
const RESCAN_MS = 30_000;
const HEADSHOT_ID = /players\/full\/(-?\d+)\./;

const myTeamId = Number(new URLSearchParams(window.location.search).get("teamId") ?? 0);

function send(message: unknown): void {
  try {
    void chrome.runtime.sendMessage(message);
  } catch {
    // Extension got reloaded/disabled; nothing sensible to do from here.
  }
}

window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const data = ev.data as { type?: string; frame?: string } | null;
  if (data?.type !== RELAY_TYPE || typeof data.frame !== "string") return;
  send({ kind: "frame", frame: data.frame, myTeamId });
});

/** Pick-rail rows read like "Jahmyr Gibbs / DET RB — R1, P1 - Spoiled Milk". */
const PICK_ROW_TEXT = /R\d+,\s*P\d+/;

function isPickRow(img: HTMLImageElement): boolean {
  let el: HTMLElement | null = img.parentElement;
  for (let depth = 0; el && depth < 5; depth++, el = el.parentElement) {
    const text = el.textContent ?? "";
    // Row-sized text only; a match on a huge container means we climbed too far.
    if (text.length < 200 && PICK_ROW_TEXT.test(text)) return true;
  }
  return false;
}

/**
 * Scrapes player ids from drafted-pick rows (identified by their "R1, P4"
 * text, which the available-players table never shows) and, separately, the
 * viewer's roster panel — which is how re-scanned picks get attributed as
 * "mine", since rail rows carry team names rather than ids.
 */
function rescan(): void {
  const railIds: number[] = [];
  const rosterIds: number[] = [];
  const seen = new Set<number>();

  const rosterPanel = document.querySelector('[class*="roster" i]');
  for (const img of Array.from(document.querySelectorAll<HTMLImageElement>("img"))) {
    const match = HEADSHOT_ID.exec(img.src);
    if (!match) continue;
    const id = Number(match[1]);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    if (rosterPanel?.contains(img)) {
      seen.add(id);
      rosterIds.push(id);
    } else if (isPickRow(img)) {
      seen.add(id);
      railIds.push(id);
    }
  }

  if (railIds.length > 0 || rosterIds.length > 0) {
    send({ kind: "rescan", railIds, rosterIds, myTeamId });
  }
}

window.addEventListener("load", () => {
  // The room renders after load; give React a beat before the first scan.
  setTimeout(rescan, 5_000);
  setInterval(rescan, RESCAN_MS);
});

export {};
