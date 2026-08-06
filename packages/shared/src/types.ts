import type { DraftOrder } from "./draftOrder.js";
import type { RankedPlayer } from "./tiers.js";

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

/**
 * Scope of a ranking list. Per-position (mirroring how tier sources publish),
 * FLX (RB/WR/TE), or OVERALL — a full cross-position draft board (top-200
 * style, e.g. FootballGuys / BeerSheets).
 */
export type BoardPosition = Position | "FLX" | "OVERALL";

/**
 * Vocabulary note — one concept, three names. The UI calls this a **Cheat
 * Sheet**; the code calls it a **sorting** (NewSortingModal, onSortingCreated,
 * the "sortings" View) and a **board** (BoardMeta, BoardsView, /boards). Only
 * the user-facing copy was renamed. Unrelated: RunningBoard / "Draft board" is
 * the live pick-by-pick log, which has nothing to do with BoardMeta.
 */

/** How a sorting (board) was seeded from sources. */
export type SeedTool = "single" | "consensus";

export interface BoardMeta {
  id: string;
  ownerId: string;
  name: string;
  position: BoardPosition;
  scoring: ScoringFormat;
  bands: TierBand[];
  /**
   * Optimistic-concurrency version for the meta document (name + bands).
   * Absent on boards written before versioning existed; treat as 0.
   */
  version?: number;
  createdAt: string;
  updatedAt: string;
  /** Immutable sources this sorting was seeded from (provenance; optional). */
  sourceIds?: string[];
  /** Tool that seeded this sorting (optional; absent on directly-made boards). */
  seededBy?: SeedTool;
}

/** One immutable imported ranking list; the raw input to sortings. */
export interface SourceMeta {
  id: string;
  ownerId: string;
  name: string;
  scope: BoardPosition;
  scoring: ScoringFormat;
  entryCount: number;
  createdAt: string;
}

export interface Source {
  meta: SourceMeta;
  /** Ranked players with canonical (Sleeper) ids; immutable once created. */
  entries: RankedPlayer[];
}

/** Fixed palette for tag badges — colors map to CSS classes, not a free picker. */
export const TAG_COLORS = ["red", "amber", "green", "blue", "purple", "gray"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/** A user-defined, editable set of players (e.g. "Sleepers", "My guys"). */
export interface TagMeta {
  id: string;
  ownerId: string;
  label: string;
  color: TagColor;
  playerCount: number;
  createdAt: string;
  updatedAt: string;
  /** Optimistic-concurrency version; increments on every save. */
  version: number;
  /** Marks the single system-maintained handcuff tag; absent on ordinary tags. */
  autoManaged?: "handcuff";
}

export interface Tag {
  meta: TagMeta;
  /** Membership only — no ranks/tiers, unlike Sources. */
  playerIds: string[];
  /** Subset of playerIds the handcuff algorithm added; safe to retract later. */
  autoAddedIds?: string[];
  /** Qualifying ids the user manually removed; never auto-re-added. */
  autoExcludedIds?: string[];
}

/** Per-player consensus agreement, captured when a consensus sorting is seeded. */
export interface PlayerAgreement {
  /** How many of the seed sources ranked this player. */
  coverage: number;
  /** Population stddev of the player's ranks across sources (0 = unanimous). */
  spread: number;
}

/** playerId -> agreement; present only on consensus-seeded boards. */
export type BoardAgreement = Record<string, PlayerAgreement>;

/** A player's ADP from each market, for one scoring format. */
export interface AdpForPlayer {
  /** ESPN market ADP (overall pick number); format-agnostic. */
  espn?: number;
  /** Fantasy Football Calculator ADP for the relevant format. */
  ffc?: number;
}

/**
 * Published ADP feed (adp.json). ESPN gives a single ADP per player; FFC is
 * per scoring format. Both keyed by canonical (Sleeper) player id.
 */
export interface AdpFile {
  updatedAt: string;
  espn: Record<string, number>;
  ffc: Record<ScoringFormat, Record<string, number>>;
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
  /** ESPN fantasy team id that made the pick; known for ESPN-synced picks. */
  espnTeamId?: number;
}

/** Most entries a single source may hold; enforced by the API and checked before import. */
export const MAX_SOURCE_ENTRIES = 1000;

/** One row parsed from any rankings source, before player matching. */
export interface ParsedEntry {
  name: string;
  rank: number;
  tier: number;
  /** Present when the source states it (ESPN's PDF does); used to disambiguate matches. */
  position?: Position;
  /** NFL team abbreviation as the source wrote it; canonicalized at match time. */
  team?: string;
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
  /** Absent until the user sets one up or round 1 derives it. */
  order?: DraftOrder;
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
