import type { Player, Tag } from "./types.js";

/** A 2nd handcuff is only tagged if his rank is within this gap of the 1st. */
export const HANDCUFF_RANK_GAP = 20;

export interface ComputeHandcuffInput {
  /** RBs currently drafted by me (mine === true, position RB). */
  myRbIds: string[];
  /** Canonical player universe. */
  players: Player[];
  /** playerId -> ordinal rank (1 = best). Missing = unranked/excluded. */
  rankById: Map<string, number>;
  /** Every drafted player id (any owner); teammates already drafted are excluded. */
  draftedIds: Set<string>;
}

/**
 * For each of your drafted RBs, find his backup(s) on the same team: the
 * highest-ranked undrafted teammate, plus a 2nd only if he's within
 * HANDCUFF_RANK_GAP ranks of the 1st (a likely committee). Never more than 2
 * per lead RB. Returns the union across all of myRbIds, deduped.
 */
export function computeHandcuffIds(input: ComputeHandcuffInput): string[] {
  const { myRbIds, players, rankById, draftedIds } = input;
  const playersById = new Map(players.map((p) => [p.id, p]));

  const byTeam = new Map<string, Player[]>();
  for (const p of players) {
    if (p.position !== "RB" || p.team == null) continue;
    const list = byTeam.get(p.team);
    if (list) list.push(p);
    else byTeam.set(p.team, [p]);
  }

  const result = new Set<string>();
  for (const leadId of myRbIds) {
    const lead = playersById.get(leadId);
    if (!lead || lead.team == null) continue;
    const teammates = (byTeam.get(lead.team) ?? []).filter(
      (p) => p.id !== leadId && !draftedIds.has(p.id) && rankById.has(p.id)
    );
    const ranked = teammates
      .map((p) => ({ id: p.id, rank: rankById.get(p.id)! }))
      .sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (ranked.length === 0) continue;
    result.add(ranked[0]!.id);
    if (ranked.length > 1 && ranked[1]!.rank - ranked[0]!.rank <= HANDCUFF_RANK_GAP) {
      result.add(ranked[1]!.id);
    }
  }
  return [...result];
}

export interface ReconcileResult {
  playerIds: string[];
  autoAddedIds: string[];
  autoExcludedIds: string[];
  /** Ids newly added this recompute (for the toast). */
  added: string[];
  /** Ids retracted this recompute (auto-added but no longer qualifying). */
  removed: string[];
}

/** Diff the existing handcuff Tag (or null) against freshly computed ids. */
export function reconcileHandcuffTag(existing: Tag | null, computedIds: string[]): ReconcileResult {
  const prevPlayerIds = existing?.playerIds ?? [];
  const prevAdded = existing?.autoAddedIds ?? [];
  const excluded = existing?.autoExcludedIds ?? [];
  const computedSet = new Set(computedIds);
  const prevPlayerSet = new Set(prevPlayerIds);
  const excludedSet = new Set(excluded);

  const removed = prevAdded.filter((id) => !computedSet.has(id));
  const removedSet = new Set(removed);
  const added = computedIds.filter((id) => !prevPlayerSet.has(id) && !excludedSet.has(id));

  return {
    playerIds: [...prevPlayerIds.filter((id) => !removedSet.has(id)), ...added],
    autoAddedIds: [...prevAdded.filter((id) => !removedSet.has(id)), ...added],
    autoExcludedIds: excluded,
    added,
    removed,
  };
}
