import { useMemo, useState } from "react";
import type { Player, Position } from "@drafthelper/shared";
import { buildNameIndex, MIN_QUERY_LENGTH, searchPlayers } from "@drafthelper/shared";
import "./PlayerPicker.css";

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];
/** Rows rendered at once; the full universe is thousands of players. */
const VISIBLE_LIMIT = 100;

interface Props {
  players: Player[];
  /** Already-selected ids, shown as "added" and not clickable. */
  selected: ReadonlySet<string>;
  onAdd: (playerId: string) => void;
}

/**
 * Search-and-click player selection: type-ahead over the whole player
 * universe, plus a position-filtered browse list for when you don't have a
 * name in mind. Render is capped rather than virtualized — searching or
 * filtering is the intended way to narrow, and it keeps the DOM light.
 */
export function PlayerPicker({ players, selected, onAdd }: Props) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<Position | "ALL">("ALL");

  // Built once per player list, not per keystroke — normalizing thousands of
  // names on every character was the whole cost of this search.
  const nameIndex = useMemo(() => buildNameIndex(players), [players]);

  const pool = useMemo(
    () => (position === "ALL" ? players : players.filter((p) => p.position === position)),
    [players, position]
  );

  // searchPlayers returns [] below MIN_QUERY_LENGTH, so browse the pool until
  // the query is long enough — otherwise the first keystroke empties the list.
  const matches = useMemo(
    () =>
      query.trim().length >= MIN_QUERY_LENGTH
        ? // Ask for the whole match set, not VISIBLE_LIMIT, so the "showing N of M"
          // count below is the real total rather than the render cap.
          searchPlayers(query, pool, undefined, pool.length, nameIndex)
        : pool,
    [query, pool, nameIndex]
  );

  const shown = matches.slice(0, VISIBLE_LIMIT);

  return (
    <div className="player-picker">
      <input
        className="player-picker-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search players by name…"
        aria-label="Search players"
      />
      <div className="player-picker-filters">
        <button
          type="button"
          className={position === "ALL" ? "player-picker-chip is-on" : "player-picker-chip"}
          onClick={() => setPosition("ALL")}
        >
          All
        </button>
        {POSITIONS.map((p) => (
          <button
            key={p}
            type="button"
            className={position === p ? "player-picker-chip is-on" : "player-picker-chip"}
            onClick={() => setPosition(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="muted">No players match.</p>
      ) : (
        <ul className="player-picker-list">
          {shown.map((p) => {
            const added = selected.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="player-picker-row"
                  disabled={added}
                  onClick={() => onAdd(p.id)}
                  data-position={p.position}
                >
                  <span className="player-picker-name">{p.name}</span>
                  <span className="player-picker-meta">
                    {p.position} · {p.team ?? "FA"}
                  </span>
                  <span className="player-picker-add">{added ? "added" : "+"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {matches.length > VISIBLE_LIMIT && (
        <p className="muted">
          Showing {VISIBLE_LIMIT} of {matches.length} — search or filter to narrow.
        </p>
      )}
    </div>
  );
}
