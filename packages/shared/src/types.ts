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

/** Boards are per-position in Phase 1, mirroring how tier sources publish. */
export type BoardPosition = Position | "FLX";

export interface BoardMeta {
  id: string;
  ownerId: string;
  name: string;
  position: BoardPosition;
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
  playerId: string;
  source: PickSource;
  /** True when this pick belongs to the session owner's team. */
  mine: boolean;
  pickedAt: string;
  /** Overall pick number, 1-based; known for ESPN-synced picks. */
  overall?: number;
}

/** One row parsed from any rankings source, before player matching. */
export interface ParsedEntry {
  name: string;
  rank: number;
  tier: number;
}

export interface MatchCandidate {
  player: Player;
  distance: number;
}

export interface MatchedEntry {
  entry: ParsedEntry;
  player: Player;
}

export interface UnmatchedEntry {
  entry: ParsedEntry;
  candidates: MatchCandidate[];
}

export interface MatchResult {
  matched: MatchedEntry[];
  unmatched: UnmatchedEntry[];
}

/** One pick as observed by the browser extension in the ESPN draft room. */
export interface ExtPickInput {
  espnPlayerId: number;
  /** 1-based arrival order as counted by the extension. */
  overall: number;
  /** ESPN fantasy team id that made the pick. */
  teamId: number;
}

export interface ExtPicksRequest {
  /** The user's own ESPN team id (from the draft-room URL). */
  myTeamId: number;
  picks: ExtPickInput[];
}

export interface DraftSync {
  /** Last time the extension pushed picks, or null if it never has. */
  lastPushAt: string | null;
}

/** Response shape of GET /api/draft. */
export interface DraftState {
  picks: Pick[];
  sync: DraftSync;
}

export interface SessionUser {
  id: string;
  name: string;
  admin?: boolean;
}

/** Admin-facing user row; never carries invite tokens or ESPN credentials. */
export interface AdminUserRow {
  id: string;
  name: string;
  admin: boolean;
  createdAt: string | null;
  hasEspnAuth: boolean;
}
