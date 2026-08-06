import type { Position } from "@drafthelper/shared";
import "./PositionFilter.css";

const FILTERABLE_POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

interface Props {
  /** Empty means no filter — everything shows. */
  selected: ReadonlySet<Position>;
  onChange: (next: Set<Position>) => void;
  /** Per-position counts, shown on each chip when supplied. */
  counts?: Map<Position, number>;
}

/**
 * Position chips shared by every surface that lists players. Multi-select,
 * because "RB and WR" is a real question at a draft table ("who's left at the
 * positions I still need?"), where a single-select would make you look twice.
 */
export function PositionFilter({ selected, onChange, counts }: Props) {
  const toggle = (pos: Position) => {
    const next = new Set(selected);
    next.has(pos) ? next.delete(pos) : next.add(pos);
    onChange(next);
  };

  return (
    <div className="position-filter" role="group" aria-label="Filter by position">
      <button
        type="button"
        className={selected.size === 0 ? "position-chip is-on" : "position-chip"}
        onClick={() => onChange(new Set())}
      >
        All
      </button>
      {FILTERABLE_POSITIONS.map((pos) => {
        const count = counts?.get(pos);
        // Hide a position the current list has none of, rather than offering a
        // chip that filters to nothing.
        if (counts && !count) return null;
        return (
          <button
            key={pos}
            type="button"
            className={selected.has(pos) ? "position-chip is-on" : "position-chip"}
            data-position={pos}
            onClick={() => toggle(pos)}
            aria-pressed={selected.has(pos)}
          >
            {pos}
            {count !== undefined && <span className="position-chip-count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

