export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

export type ScoringFormat = "STD" | "HALF" | "PPR";

/** Trimmed Sleeper player record; the canonical player universe for the app. */
export interface Player {
  /** Sleeper player id — the app's canonical player key. */
  id: string;
  name: string;
  position: Position;
  /** NFL team abbreviation, or null for free agents. */
  team: string | null;
  /** ESPN player id crossref; live draft sync maps picks through this. */
  espnId: number | null;
}

/**
 * A player's spot on the 2D board. The canvas is the native model:
 * y is value (smaller = better, matching screen coordinates), x is free
 * arrangement. List views are projections of y.
 */
export interface Placement {
  x: number;
  y: number;
}

/** Horizontal stripe on the board; y0 < y1, smaller y = better. */
export interface TierBand {
  y0: number;
  y1: number;
  label: string;
}

export interface BoardMeta {
  id: string;
  ownerId: string;
  name: string;
  scoring: ScoringFormat;
  bands: TierBand[];
  createdAt: string;
  updatedAt: string;
}

export interface BoardLayout {
  /** playerId -> placement; one atomic document. */
  placements: Record<string, Placement>;
  /** Optimistic-concurrency version; increments on every save. */
  version: number;
}

export type PickSource = "espn" | "manual";

export interface Pick {
  /** Overall pick number, 1-based. */
  overall: number;
  playerId: string;
  source: PickSource;
  /** True when this pick belongs to the session owner's team. */
  mine: boolean;
  pickedAt: string;
}

export type SyncStatus = "off" | "live" | "stale" | "error";

export interface DraftSession {
  id: string;
  boardId: string;
  ownerId: string;
  espnLeagueId: string | null;
  espnSeason: number | null;
  syncStatus: SyncStatus;
  createdAt: string;
}

export interface SessionUser {
  id: string;
  name: string;
}
