import { useEffect, useState } from "react";
import type { BoardLayout, BoardMeta, Pick, Player, TagMeta } from "@drafthelper/shared";
import type { AdpLookup } from "../state/adp";
import { TierListView } from "./TierListView";
import "./DraftBoardPanel.css";

interface Props {
  boards: BoardMeta[];
  layouts: Map<string, BoardLayout>;
  playersById: Map<string, Player>;
  adp: AdpLookup;
  tagsByPlayer?: Map<string, TagMeta[]>;
  onTagPlayer?: (playerId: string) => void;
  picks: Map<string, Pick>;
  onMark: (playerId: string, mine: boolean) => void;
  onUnmark: (playerId: string) => void;
}

/**
 * The cheat sheet, at draft-day size.
 *
 * This is the thing you read while the clock runs, so it gets the room: one
 * board at full width, or several side by side when the question is "last RB
 * in this tier, or first WR in the next". It renders TierListView, so marking,
 * ADP, tags and the position filter behave exactly as they do on the Cheat
 * Sheets tab -- one list, learned once.
 */
export function DraftBoardPanel({
  boards,
  layouts,
  playersById,
  adp,
  tagsByPlayer,
  onTagPlayer,
  picks,
  onMark,
  onUnmark,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(boards[0]?.id ?? null);
  const [compare, setCompare] = useState(false);

  // Follow the board list: a deleted or freshly-created board must not leave
  // the panel pointing at nothing.
  useEffect(() => {
    if (boards.length === 0) return;
    if (!activeId || !boards.some((b) => b.id === activeId)) setActiveId(boards[0]!.id);
  }, [boards, activeId]);

  if (boards.length === 0) {
    return (
      <section className="draft-board-panel">
        <p className="muted">
          No cheat sheets yet. Build one on the Cheat Sheets tab and it shows up here.
        </p>
      </section>
    );
  }

  const shown = compare ? boards : boards.filter((b) => b.id === activeId);

  return (
    <section className="draft-board-panel">
      <header className="draft-board-tabs">
        {!compare &&
          boards.map((b) => (
            <button
              key={b.id}
              type="button"
              className={b.id === activeId ? "draft-board-tab is-on" : "draft-board-tab"}
              onClick={() => setActiveId(b.id)}
              data-position={b.position}
            >
              {b.name}
            </button>
          ))}
        {compare && <span className="draft-board-comparing">Comparing {boards.length} sheets</span>}
        {boards.length > 1 && (
          <button
            type="button"
            className="draft-board-mode"
            onClick={() => setCompare((v) => !v)}
            aria-pressed={compare}
          >
            {compare ? "Show one" : "Compare"}
          </button>
        )}
      </header>

      <div className={compare ? "draft-board-grid is-compare" : "draft-board-grid"}>
        {shown.map((board) => {
          const layout = layouts.get(board.id);
          return (
            <div key={board.id} className="draft-board-column">
              {compare && (
                <h3 className="draft-board-column-title" data-position={board.position}>
                  {board.name}
                </h3>
              )}
              {layout ? (
                <TierListView
                  meta={board}
                  layout={layout}
                  playersById={playersById}
                  adp={adp}
                  tagsByPlayer={tagsByPlayer}
                  onTagPlayer={onTagPlayer}
                  picks={picks}
                  onMark={onMark}
                  onUnmark={onUnmark}
                />
              ) : (
                <p className="muted">Loading {board.name}…</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
