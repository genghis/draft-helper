/**
 * Parser for ESPN draft-room websocket frames (protocol captured 2026-07-24;
 * see test/fixtures/espn-draft/PROTOCOL.md). Frames are plain text, one
 * space-delimited command per line. Unknown commands are ignored, never
 * thrown on — ESPN adds message types freely.
 */

export type EspnDraftEvent =
  | { type: "pick"; teamId: number; espnPlayerId: number; lineupSlotId: number }
  | { type: "selecting"; teamId: number; clockMs: number }
  | { type: "autodraft"; teamId: number; enabled: boolean };

/** Parses one websocket frame (possibly multiple newline-separated commands). */
export function parseDraftFrame(raw: string): EspnDraftEvent[] {
  const events: EspnDraftEvent[] = [];
  for (const line of raw.split("\n")) {
    const parts = line.trim().split(/\s+/);
    switch (parts[0]) {
      case "SELECTED": {
        const teamId = Number(parts[1]);
        const espnPlayerId = Number(parts[2]);
        const rawSlot = Number(parts[3]);
        const lineupSlotId = Number.isFinite(rawSlot) ? rawSlot : 0;
        if (Number.isFinite(teamId) && Number.isFinite(espnPlayerId)) {
          events.push({ type: "pick", teamId, espnPlayerId, lineupSlotId });
        }
        break;
      }
      case "SELECTING": {
        const teamId = Number(parts[1]);
        const clockMs = Number(parts[2]);
        if (Number.isFinite(teamId) && Number.isFinite(clockMs)) {
          events.push({ type: "selecting", teamId, clockMs });
        }
        break;
      }
      case "AUTODRAFT": {
        const teamId = Number(parts[1]);
        if (Number.isFinite(teamId)) {
          events.push({ type: "autodraft", teamId, enabled: parts[2] === "true" });
        }
        break;
      }
      default:
        break;
    }
  }
  return events;
}
