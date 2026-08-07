import type { BoardLayout, BoardMeta, Pick, Player, TagMeta } from "@drafthelper/shared";
import { bestAvailable, currentTierScarcity, formatAdp, primaryAdp } from "@drafthelper/shared";
import type { AdpLookup } from "../state/adp";
import { TagBadges } from "../components/TagBadges";
import { PlayerPositionBadge } from "../components/PositionBadge";
import "../components/PlayerRowActions.css";
import "./BestAvailableRail.css";

interface Props {
  boards: BoardMeta[];
  layouts: Map<string, BoardLayout>;
  playersById: Map<string, Player>;
  adp: AdpLookup;
  tagsByPlayer?: Map<string, TagMeta[]>;
  onTagPlayer?: (playerId: string) => void;
  picks: Map<string, Pick>;
}

/** Per-position card: current tier scarcity + top remaining players with ADP. */
export function BestAvailableRail({
  boards,
  layouts,
  playersById,
  adp,
  tagsByPlayer,
  onTagPlayer,
  picks,
}: Props) {
  const picked = new Set(picks.keys());
  return (
    <div className="rail">
      {boards.map((board) => {
        const layout = layouts.get(board.id);
        if (!layout) return null;
        const scarcity = currentTierScarcity(layout.placements, board.bands, picked);
        const top = bestAvailable(layout.placements, picked);
        return (
          <section key={board.id} className="rail-card" data-position={board.position}>
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
              {top.map((id) => {
                const marketAdp = primaryAdp(adp.forPlayer(board.scoring, id));
                return (
                  <li key={id}>
                    <PlayerPositionBadge player={playersById.get(id)} />
                    <span className="rail-player">{playersById.get(id)?.name ?? id}</span>
                    {marketAdp != null && (
                      <span className="rail-adp" title="Market ADP (overall pick)">
                        {formatAdp(marketAdp)}
                      </span>
                    )}
                    <TagBadges tags={tagsByPlayer?.get(id)} />
                    {onTagPlayer && (
                      <button
                        type="button"
                        className="tier-tag-btn"
                        onClick={() => onTagPlayer(id)}
                        title={`Tag ${playersById.get(id)?.name ?? id}`}
                        aria-label={`Tag ${playersById.get(id)?.name ?? id}`}
                      >
                        ⊕
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
