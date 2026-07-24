import type { BoardLayout, BoardMeta, Pick, Player } from "@drafthelper/shared";
import { bestAvailable, currentTierScarcity } from "@drafthelper/shared";
import "./BestAvailableRail.css";

interface Props {
  boards: BoardMeta[];
  layouts: Map<string, BoardLayout>;
  playersById: Map<string, Player>;
  picks: Map<string, Pick>;
}

/** Per-position card: current tier scarcity + top remaining players. */
export function BestAvailableRail({ boards, layouts, playersById, picks }: Props) {
  const picked = new Set(picks.keys());
  return (
    <div className="rail">
      {boards.map((board) => {
        const layout = layouts.get(board.id);
        if (!layout) return null;
        const scarcity = currentTierScarcity(layout.placements, board.bands, picked);
        const top = bestAvailable(layout.placements, picked);
        return (
          <section key={board.id} className="rail-card">
            <header className="rail-card-header">
              <span className="rail-position">{board.position}</span>
              {scarcity ? (
                <span
                  className={
                    scarcity.remaining <= 1 ? "rail-scarcity rail-scarcity-low" : "rail-scarcity"
                  }
                >
                  {scarcity.remaining} left in {scarcity.band.label}
                </span>
              ) : (
                <span className="rail-scarcity muted">exhausted</span>
              )}
            </header>
            <ol className="rail-names">
              {top.map((id) => (
                <li key={id}>{playersById.get(id)?.name ?? id}</li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
